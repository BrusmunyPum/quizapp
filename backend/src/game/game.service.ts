import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  QuizzesService,
  QuizData,
  QuestionData,
  PublicOptionData,
} from '../quizzes/quizzes.service';

export type RoomStatus =
  | 'LOBBY'
  | 'QUESTION_ACTIVE'
  | 'QUESTION_RESULT'
  | 'FINISHED';

export interface Participant {
  playerId: string;
  playerToken: string;
  socketId: string | null;
  connected: boolean;
  dbParticipantId?: string;
  nickname: string;
  score: number;
  streak: number;
  hasAnsweredCurrent: boolean;
  lastPointsEarned: number;
  lastIsCorrect: boolean;
  lastRank: number;
  joinedAt: number;
  disconnectTimer?: NodeJS.Timeout;
}

export interface PlayerAnswerRecord {
  optionId: string;
  questionId: string;
  responseTimeMs: number;
  points: number;
  isCorrect: boolean;
}

export interface PublicQuestionPayload {
  id: string;
  prompt: string;
  questionType: string;
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: PublicOptionData[];
  questionNumber: number;
  totalQuestions: number;
  endsAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  streak: number;
  lastPointsEarned: number;
}

export interface PlayerRoundFeedback {
  playerId: string;
  socketId: string | null;
  isCorrect: boolean;
  points: number;
  totalScore: number;
  streak: number;
  rank: number;
  timedOut: boolean;
}

export interface QuestionResultsPayload {
  correctOptionId?: string;
  correctOptionIds: string[];
  optionCounts: Record<string, number>;
  leaderboard: LeaderboardEntry[];
  playerFeedback: PlayerRoundFeedback[];
}

export interface PodiumEntry {
  rank: number;
  nickname: string;
  score: number;
}

export interface GameRoom {
  pin: string;
  dbRoomId?: string;
  quiz: QuizData;
  hostSocketId: string | null;
  hostToken: string;
  hostConnected: boolean;
  hostDisconnectTimer?: NodeJS.Timeout;
  status: RoomStatus;
  currentQuestionIndex: number;
  questionStartTime: number;
  questionEndsAt: number;
  questionTimer?: NodeJS.Timeout;
  lastQuestionResults: QuestionResultsPayload | null;
  participants: Map<string, Participant>; // playerId -> Participant
  currentAnswers: Map<string, PlayerAnswerRecord>; // playerId -> PlayerAnswerRecord
  createdAt: number;
  lastActivityAt: number;
  finishedAt?: number;
}

interface SessionBinding {
  pin: string;
  role: 'host' | 'player';
  playerId?: string;
}

const MAX_ACTIVE_ROOMS = 1000;
const MAX_PLAYERS_PER_ROOM = 200;
const FINISHED_ROOM_TTL_MS = 30 * 60 * 1000;
const IDLE_ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const HOST_RECONNECT_GRACE_MS = 5 * 60 * 1000;
const PLAYER_LOBBY_GRACE_MS = 30 * 1000;
const LATE_ANSWER_GRACE_MS = 500;

@Injectable()
export class GameService implements OnModuleDestroy {
  private readonly logger = new Logger(GameService.name);
  private readonly rooms: Map<string, GameRoom> = new Map();
  private readonly socketToSession: Map<string, SessionBinding> = new Map();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly prisma: PrismaService,
  ) {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRooms();
    }, 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
    for (const pin of Array.from(this.rooms.keys())) {
      this.clearRoomTimers(pin);
    }
    this.rooms.clear();
    this.socketToSession.clear();
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  getRoom(pin: string): GameRoom | undefined {
    return this.rooms.get(pin);
  }

  getSessionBySocket(socketId: string): SessionBinding | undefined {
    return this.socketToSession.get(socketId);
  }

  private generatePin(): string {
    let pin: string;
    let attempts = 0;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      attempts++;
      if (attempts > 1000) {
        throw new Error('Unable to allocate unique room PIN.');
      }
    } while (this.rooms.has(pin));
    return pin;
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private clearRoomTimers(pin: string): void {
    const room = this.rooms.get(pin);
    if (!room) return;
    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = undefined;
    }
    if (room.hostDisconnectTimer) {
      clearTimeout(room.hostDisconnectTimer);
      room.hostDisconnectTimer = undefined;
    }
    for (const p of room.participants.values()) {
      if (p.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = undefined;
      }
    }
  }

  private cleanupExpiredRooms(): void {
    const now = Date.now();
    for (const [pin, room] of this.rooms.entries()) {
      const isFinishedExpired =
        room.status === 'FINISHED' &&
        room.finishedAt !== undefined &&
        now - room.finishedAt > FINISHED_ROOM_TTL_MS;
      const isIdleExpired = now - room.lastActivityAt > IDLE_ROOM_TTL_MS;

      if (isFinishedExpired || isIdleExpired) {
        this.closeRoom(pin);
      }
    }
  }

  closeRoom(pin: string): string[] {
    const room = this.rooms.get(pin);
    if (!room) return [];

    this.clearRoomTimers(pin);

    const affectedSockets: string[] = [];
    if (room.hostSocketId) {
      this.socketToSession.delete(room.hostSocketId);
    }
    for (const p of room.participants.values()) {
      if (p.socketId) {
        affectedSockets.push(p.socketId);
        this.socketToSession.delete(p.socketId);
      }
    }

    this.rooms.delete(pin);
    return affectedSockets;
  }

  getPlayerList(pin: string): { nickname: string; score: number; connected: boolean }[] {
    const room = this.rooms.get(pin);
    if (!room) return [];

    return Array.from(room.participants.values()).map((p) => ({
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
    }));
  }

  async createRoom(
    quizId: string,
    hostSocketId: string,
    hostUserId?: string,
  ): Promise<{ room?: GameRoom; error?: string }> {
    if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
      return { error: 'Server room capacity reached. Please try again shortly.' };
    }

    const quiz = await this.quizzesService.findOneInternal(quizId);
    if (!quiz) {
      return { error: 'Quiz not found.' };
    }
    if (!quiz.isPublic && quiz.creatorId !== hostUserId) {
      return { error: 'You do not have permission to host this private quiz.' };
    }
    if (!quiz.questions || quiz.questions.length === 0) {
      return { error: 'Cannot host a quiz with zero questions.' };
    }

    const pin = this.generatePin();
    const now = Date.now();
    const room: GameRoom = {
      pin,
      quiz,
      hostSocketId,
      hostToken: this.generateToken(),
      hostConnected: true,
      status: 'LOBBY',
      currentQuestionIndex: 0,
      questionStartTime: 0,
      questionEndsAt: 0,
      lastQuestionResults: null,
      participants: new Map(),
      currentAnswers: new Map(),
      createdAt: now,
      lastActivityAt: now,
    };

    this.rooms.set(pin, room);
    this.socketToSession.set(hostSocketId, { pin, role: 'host' });

    if (this.prisma.isDbConnected()) {
      void this.prisma.room
        .create({
          data: {
            pinCode: pin,
            quizId: quiz.id,
            hostId: hostUserId ?? null,
            status: 'LOBBY',
          },
        })
        .then((created) => {
          room.dbRoomId = created.id;
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Could not persist room ${pin}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return { room };
  }

  joinRoom(
    pin: string,
    nickname: string,
    socketId: string,
  ): { success: boolean; message?: string; participant?: Participant } {
    const cleanPin = typeof pin === 'string' ? pin.trim() : '';
    if (!/^\d{6}$/.test(cleanPin)) {
      return { success: false, message: 'Please enter a valid 6-digit Game PIN.' };
    }

    const cleanNickname = typeof nickname === 'string' ? nickname.trim() : '';
    if (cleanNickname.length < 1 || cleanNickname.length > 20) {
      return {
        success: false,
        message: 'Nickname must be between 1 and 20 characters.',
      };
    }

    const room = this.rooms.get(cleanPin);
    if (!room) {
      return { success: false, message: 'Game PIN not found.' };
    }

    if (room.status !== 'LOBBY') {
      return { success: false, message: 'Game is already in progress.' };
    }

    if (room.participants.size >= MAX_PLAYERS_PER_ROOM) {
      return { success: false, message: 'This room is currently full.' };
    }

    const lowerName = cleanNickname.toLowerCase();
    for (const p of room.participants.values()) {
      if (p.nickname.toLowerCase() === lowerName) {
        return {
          success: false,
          message: 'Nickname is already taken in this room.',
        };
      }
    }

    const participant: Participant = {
      playerId: crypto.randomUUID(),
      playerToken: this.generateToken(),
      socketId,
      connected: true,
      nickname: cleanNickname,
      score: 0,
      streak: 0,
      hasAnsweredCurrent: false,
      lastPointsEarned: 0,
      lastIsCorrect: false,
      lastRank: 0,
      joinedAt: Date.now(),
    };

    room.participants.set(participant.playerId, participant);
    room.lastActivityAt = Date.now();
    this.socketToSession.set(socketId, {
      pin: cleanPin,
      role: 'player',
      playerId: participant.playerId,
    });

    if (this.prisma.isDbConnected() && room.dbRoomId) {
      void this.prisma.participant
        .create({
          data: {
            roomId: room.dbRoomId,
            nickname: participant.nickname,
            socketId,
          },
        })
        .then((created) => {
          participant.dbParticipantId = created.id;
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Could not persist participant ${participant.nickname}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return { success: true, participant };
  }

  toPublicQuestion(
    question: QuestionData,
    questionNumber: number,
    totalQuestions: number,
    endsAt: number,
  ): PublicQuestionPayload {
    return {
      id: question.id,
      prompt: question.prompt,
      questionType: question.questionType,
      timeLimitSeconds: question.timeLimitSeconds,
      points: question.points,
      mediaUrl: question.mediaUrl,
      options: question.options.map((opt) => ({
        id: opt.id,
        content: opt.content,
        colorCode: opt.colorCode,
      })),
      questionNumber,
      totalQuestions,
      endsAt,
    };
  }

  startQuestion(
    pin: string,
    onTimeout?: () => void,
  ): PublicQuestionPayload | null {
    const room = this.rooms.get(pin);
    if (!room) return null;

    if (room.currentQuestionIndex >= room.quiz.questions.length) {
      room.status = 'FINISHED';
      room.finishedAt = Date.now();
      return null;
    }

    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = undefined;
    }

    const currentQuestion = room.quiz.questions[room.currentQuestionIndex];
    const safeTimeLimit = Math.max(5, currentQuestion.timeLimitSeconds || 20);
    const now = Date.now();

    room.status = 'QUESTION_ACTIVE';
    room.questionStartTime = now;
    room.questionEndsAt = now + safeTimeLimit * 1000;
    room.lastQuestionResults = null;
    room.lastActivityAt = now;
    room.currentAnswers.clear();

    for (const p of room.participants.values()) {
      p.hasAnsweredCurrent = false;
      p.lastPointsEarned = 0;
      p.lastIsCorrect = false;
    }

    if (onTimeout) {
      room.questionTimer = setTimeout(() => {
        onTimeout();
      }, safeTimeLimit * 1000);
      room.questionTimer.unref();
    }

    this.syncRoomStatusInDb(room);

    return this.toPublicQuestion(
      { ...currentQuestion, timeLimitSeconds: safeTimeLimit },
      room.currentQuestionIndex + 1,
      room.quiz.questions.length,
      room.questionEndsAt,
    );
  }

  private getAnswerProgress(room: GameRoom): {
    answerCount: number;
    totalPlayers: number;
    allConnectedAnswered: boolean;
  } {
    let connectedPlayers = 0;
    let connectedAnswered = 0;

    for (const p of room.participants.values()) {
      if (p.connected) {
        connectedPlayers++;
        if (p.hasAnsweredCurrent) {
          connectedAnswered++;
        }
      }
    }

    return {
      answerCount: room.currentAnswers.size,
      totalPlayers: connectedPlayers || room.participants.size,
      allConnectedAnswered:
        connectedPlayers > 0 && connectedAnswered >= connectedPlayers,
    };
  }

  submitAnswer(
    pin: string,
    socketId: string,
    optionId: string,
  ): {
    success: boolean;
    message?: string;
    allAnswered: boolean;
    answerCount: number;
    totalPlayers: number;
  } {
    const fail = (message?: string) => ({
      success: false,
      message,
      allAnswered: false,
      answerCount: 0,
      totalPlayers: 0,
    });

    const session = this.socketToSession.get(socketId);
    if (!session || session.role !== 'player' || session.pin !== pin || !session.playerId) {
      return fail('Player session not found.');
    }

    const room = this.rooms.get(pin);
    if (!room || room.status !== 'QUESTION_ACTIVE') {
      return fail('Question is not currently active.');
    }

    const participant = room.participants.get(session.playerId);
    if (!participant || participant.hasAnsweredCurrent) {
      return fail('Answer already submitted.');
    }

    const currentQuestion = room.quiz.questions[room.currentQuestionIndex];
    const selectedOption = currentQuestion.options.find(
      (opt) => opt.id === optionId,
    );
    if (!selectedOption) {
      return fail('Selected option does not belong to this question.');
    }

    const safeTimeLimit = Math.max(5, currentQuestion.timeLimitSeconds || 20);
    const totalTimeMs = safeTimeLimit * 1000;
    const elapsedMs = Math.max(0, Date.now() - room.questionStartTime);

    if (elapsedMs > totalTimeMs + LATE_ANSWER_GRACE_MS) {
      return fail('Time expired for this question.');
    }

    const clampedElapsedMs = Math.min(elapsedMs, totalTimeMs);
    const isCorrect = selectedOption.isCorrect;

    let points = 0;
    if (isCorrect) {
      const speedFactor = 1 - clampedElapsedMs / (2 * totalTimeMs);
      const basePoints = Math.round(
        currentQuestion.points * Math.max(0.5, speedFactor),
      );
      const streakBonus = participant.streak * 50;
      points = basePoints + streakBonus;

      participant.score += points;
      participant.streak += 1;
    } else {
      participant.streak = 0;
    }

    participant.hasAnsweredCurrent = true;
    participant.lastPointsEarned = points;
    participant.lastIsCorrect = isCorrect;
    room.lastActivityAt = Date.now();

    room.currentAnswers.set(participant.playerId, {
      optionId,
      questionId: currentQuestion.id,
      responseTimeMs: clampedElapsedMs,
      points,
      isCorrect,
    });

    if (this.prisma.isDbConnected() && participant.dbParticipantId) {
      void Promise.all([
        this.prisma.participantAnswer.upsert({
          where: {
            participantId_questionId: {
              participantId: participant.dbParticipantId,
              questionId: currentQuestion.id,
            },
          },
          update: {},
          create: {
            participantId: participant.dbParticipantId,
            questionId: currentQuestion.id,
            selectedOptionId: selectedOption.id,
            responseTimeMs: clampedElapsedMs,
            pointsAwarded: points,
            isCorrect,
          },
        }),
        this.prisma.participant.update({
          where: { id: participant.dbParticipantId },
          data: {
            totalScore: participant.score,
            streak: participant.streak,
          },
        }),
      ]).catch((err: unknown) => {
        this.logger.warn(
          `Could not persist answer for ${participant.nickname}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const progress = this.getAnswerProgress(room);

    return {
      success: true,
      allAnswered: progress.allConnectedAnswered,
      answerCount: progress.answerCount,
      totalPlayers: progress.totalPlayers,
    };
  }

  getQuestionResults(pin: string): QuestionResultsPayload | null {
    const room = this.rooms.get(pin);
    if (!room || room.status !== 'QUESTION_ACTIVE') {
      return null;
    }

    const currentQuestion = room.quiz.questions[room.currentQuestionIndex];
    if (!currentQuestion) return null;

    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = undefined;
    }

    room.status = 'QUESTION_RESULT';
    room.lastActivityAt = Date.now();

    for (const p of room.participants.values()) {
      if (!p.hasAnsweredCurrent) {
        p.streak = 0;
        p.lastPointsEarned = 0;
        p.lastIsCorrect = false;
      }
    }

    const optionCounts: Record<string, number> = {};
    currentQuestion.options.forEach((opt) => {
      optionCounts[opt.id] = 0;
    });

    for (const ans of room.currentAnswers.values()) {
      if (optionCounts[ans.optionId] !== undefined) {
        optionCounts[ans.optionId]++;
      }
    }

    const rankedParticipants = Array.from(room.participants.values()).sort(
      (a, b) => b.score - a.score || a.joinedAt - b.joinedAt,
    );

    rankedParticipants.forEach((p, index) => {
      p.lastRank = index + 1;
    });

    const leaderboard: LeaderboardEntry[] = rankedParticipants
      .slice(0, 5)
      .map((p) => ({
        rank: p.lastRank,
        nickname: p.nickname,
        score: p.score,
        streak: p.streak,
        lastPointsEarned: p.lastPointsEarned,
      }));

    const playerFeedback: PlayerRoundFeedback[] = rankedParticipants.map((p) => ({
      playerId: p.playerId,
      socketId: p.socketId,
      isCorrect: p.lastIsCorrect,
      points: p.lastPointsEarned,
      totalScore: p.score,
      streak: p.streak,
      rank: p.lastRank,
      timedOut: !p.hasAnsweredCurrent,
    }));

    const correctOptionIds = currentQuestion.options
      .filter((o) => o.isCorrect)
      .map((o) => o.id);

    const payload: QuestionResultsPayload = {
      correctOptionId: correctOptionIds[0],
      correctOptionIds,
      optionCounts,
      leaderboard,
      playerFeedback,
    };

    room.lastQuestionResults = payload;
    this.syncRoomStatusInDb(room);
    return payload;
  }

  nextQuestion(pin: string): {
    isFinished: boolean;
    podium?: PodiumEntry[];
    finalStandings?: {
      playerId: string;
      socketId: string | null;
      rank: number;
      score: number;
    }[];
  } | null {
    const room = this.rooms.get(pin);
    if (!room || room.status !== 'QUESTION_RESULT') return null;

    room.currentQuestionIndex++;
    room.lastActivityAt = Date.now();

    if (room.currentQuestionIndex >= room.quiz.questions.length) {
      room.status = 'FINISHED';
      room.finishedAt = Date.now();
      this.syncRoomStatusInDb(room);

      const ranked = Array.from(room.participants.values()).sort(
        (a, b) => b.score - a.score || a.joinedAt - b.joinedAt,
      );

      return {
        isFinished: true,
        podium: ranked.slice(0, 3).map((p, index) => ({
          rank: index + 1,
          nickname: p.nickname,
          score: p.score,
        })),
        finalStandings: ranked.map((p, index) => ({
          playerId: p.playerId,
          socketId: p.socketId,
          rank: index + 1,
          score: p.score,
        })),
      };
    }

    return { isFinished: false };
  }

  getPodium(pin: string): PodiumEntry[] {
    const room = this.rooms.get(pin);
    if (!room) return [];

    return Array.from(room.participants.values())
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .slice(0, 3)
      .map((p, index) => ({
        rank: index + 1,
        nickname: p.nickname,
        score: p.score,
      }));
  }

  rejoinRoom(
    pin: string,
    token: string,
    newSocketId: string,
  ):
    | {
        success: true;
        role: 'host' | 'player';
        pin: string;
        quizTitle: string;
        totalQuestions: number;
        gameState: 'lobby' | 'question' | 'result' | 'podium';
        players: { nickname: string; score: number; connected: boolean }[];
        currentQuestion?: PublicQuestionPayload;
        answerCount: number;
        totalPlayers: number;
        questionResults?: Omit<QuestionResultsPayload, 'playerFeedback'>;
        podium?: PodiumEntry[];
        nickname?: string;
        playerScore?: number;
        playerRank?: number;
        playerStreak?: number;
        hasSubmittedAnswer?: boolean;
        selectedOptionId?: string | null;
        answerResult?: {
          isCorrect: boolean;
          points: number;
          streak: number;
          rank: number;
          timedOut: boolean;
        } | null;
      }
    | { success: false; message: string } {
    const room = this.rooms.get(pin);
    if (!room) {
      return { success: false, message: 'Game session no longer exists.' };
    }

    const mappedState =
      room.status === 'LOBBY'
        ? 'lobby'
        : room.status === 'QUESTION_ACTIVE'
          ? 'question'
          : room.status === 'QUESTION_RESULT'
            ? 'result'
            : 'podium';

    const currentQ = room.quiz.questions[room.currentQuestionIndex];
    const publicQuestion =
      (room.status === 'QUESTION_ACTIVE' || room.status === 'QUESTION_RESULT') &&
      currentQ
        ? this.toPublicQuestion(
            currentQ,
            room.currentQuestionIndex + 1,
            room.quiz.questions.length,
            room.questionEndsAt,
          )
        : undefined;

    const publicResults = room.lastQuestionResults
      ? {
          correctOptionId: room.lastQuestionResults.correctOptionId,
          correctOptionIds: room.lastQuestionResults.correctOptionIds,
          optionCounts: room.lastQuestionResults.optionCounts,
          leaderboard: room.lastQuestionResults.leaderboard,
        }
      : undefined;

    const progress = this.getAnswerProgress(room);

    if (token === room.hostToken) {
      if (room.hostSocketId && room.hostSocketId !== newSocketId) {
        this.socketToSession.delete(room.hostSocketId);
      }
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = undefined;
      }

      room.hostSocketId = newSocketId;
      room.hostConnected = true;
      room.lastActivityAt = Date.now();
      this.socketToSession.set(newSocketId, { pin, role: 'host' });

      return {
        success: true,
        role: 'host',
        pin: room.pin,
        quizTitle: room.quiz.title,
        totalQuestions: room.quiz.questions.length,
        gameState: mappedState,
        players: this.getPlayerList(pin),
        currentQuestion: publicQuestion,
        answerCount: progress.answerCount,
        totalPlayers: progress.totalPlayers,
        questionResults: publicResults,
        podium: room.status === 'FINISHED' ? this.getPodium(pin) : undefined,
      };
    }

    for (const participant of room.participants.values()) {
      if (participant.playerToken === token) {
        if (participant.socketId && participant.socketId !== newSocketId) {
          this.socketToSession.delete(participant.socketId);
        }
        if (participant.disconnectTimer) {
          clearTimeout(participant.disconnectTimer);
          participant.disconnectTimer = undefined;
        }

        participant.socketId = newSocketId;
        participant.connected = true;
        room.lastActivityAt = Date.now();
        this.socketToSession.set(newSocketId, {
          pin,
          role: 'player',
          playerId: participant.playerId,
        });

        const ans = room.currentAnswers.get(participant.playerId);

        return {
          success: true,
          role: 'player',
          pin: room.pin,
          quizTitle: room.quiz.title,
          totalQuestions: room.quiz.questions.length,
          gameState: mappedState,
          players: this.getPlayerList(pin),
          currentQuestion: publicQuestion,
          answerCount: progress.answerCount,
          totalPlayers: progress.totalPlayers,
          questionResults: publicResults,
          podium: room.status === 'FINISHED' ? this.getPodium(pin) : undefined,
          nickname: participant.nickname,
          playerScore: participant.score,
          playerRank: participant.lastRank || undefined,
          playerStreak: participant.streak,
          hasSubmittedAnswer: participant.hasAnsweredCurrent,
          selectedOptionId: ans?.optionId ?? null,
          answerResult:
            room.status === 'QUESTION_RESULT'
              ? {
                  isCorrect: participant.lastIsCorrect,
                  points: participant.lastPointsEarned,
                  streak: participant.streak,
                  rank: participant.lastRank,
                  timedOut: !participant.hasAnsweredCurrent,
                }
              : null,
        };
      }
    }

    return { success: false, message: 'Reconnect token is invalid or expired.' };
  }

  leaveRoomExplicit(socketId: string): {
    pin?: string;
    role?: 'host' | 'player';
    roomClosed?: boolean;
    shouldFinishQuestion?: boolean;
  } {
    const session = this.socketToSession.get(socketId);
    if (!session) return {};
    this.socketToSession.delete(socketId);

    const room = this.rooms.get(session.pin);
    if (!room) return {};

    if (session.role === 'host') {
      this.closeRoom(session.pin);
      return { pin: session.pin, role: 'host', roomClosed: true };
    }

    if (session.playerId) {
      const participant = room.participants.get(session.playerId);
      if (participant?.disconnectTimer) {
        clearTimeout(participant.disconnectTimer);
      }
      room.participants.delete(session.playerId);
      room.currentAnswers.delete(session.playerId);

      const shouldFinishQuestion =
        room.status === 'QUESTION_ACTIVE' &&
        this.getAnswerProgress(room).allConnectedAnswered;

      return {
        pin: session.pin,
        role: 'player',
        roomClosed: false,
        shouldFinishQuestion,
      };
    }

    return {};
  }

  handleDisconnect(
    socketId: string,
    onHostExpired?: (pin: string) => void,
    onLobbyPlayerExpired?: (pin: string) => void,
  ): {
    pin?: string;
    role?: 'host' | 'player';
    shouldFinishQuestion?: boolean;
  } {
    const session = this.socketToSession.get(socketId);
    if (!session) return {};
    this.socketToSession.delete(socketId);

    const room = this.rooms.get(session.pin);
    if (!room) return {};

    if (session.role === 'host') {
      room.hostConnected = false;
      room.hostSocketId = null;

      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
      }
      room.hostDisconnectTimer = setTimeout(() => {
        if (!room.hostConnected) {
          onHostExpired?.(session.pin);
        }
      }, HOST_RECONNECT_GRACE_MS);
      room.hostDisconnectTimer.unref();

      return { pin: session.pin, role: 'host' };
    }

    if (session.playerId) {
      const participant = room.participants.get(session.playerId);
      if (!participant) return {};

      participant.connected = false;
      participant.socketId = null;

      if (room.status === 'LOBBY') {
        if (participant.disconnectTimer) {
          clearTimeout(participant.disconnectTimer);
        }
        participant.disconnectTimer = setTimeout(() => {
          const currentRoom = this.rooms.get(session.pin);
          if (
            currentRoom &&
            currentRoom.status === 'LOBBY' &&
            !participant.connected
          ) {
            currentRoom.participants.delete(participant.playerId);
            onLobbyPlayerExpired?.(session.pin);
          }
        }, PLAYER_LOBBY_GRACE_MS);
        participant.disconnectTimer.unref();
      }

      const shouldFinishQuestion =
        room.status === 'QUESTION_ACTIVE' &&
        this.getAnswerProgress(room).allConnectedAnswered;

      return {
        pin: session.pin,
        role: 'player',
        shouldFinishQuestion,
      };
    }

    return {};
  }

  private syncRoomStatusInDb(room: GameRoom): void {
    if (!this.prisma.isDbConnected() || !room.dbRoomId) return;

    void this.prisma.room
      .update({
        where: { id: room.dbRoomId },
        data: {
          status: room.status,
          currentQuestionIndex: room.currentQuestionIndex,
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Could not update room ${room.pin} status: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
