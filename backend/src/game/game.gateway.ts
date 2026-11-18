import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { getEnvConfig, isOriginAllowed } from '../config/env';
import { GameService } from './game.service';

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const config = getEnvConfig();
      if (isOriginAllowed(origin, config)) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed by WebSocket CORS policy'));
      }
    },
    credentials: true,
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  private readonly socketEventCounts = new Map<
    string,
    { count: number; windowStart: number }
  >();

  constructor(
    private readonly gameService: GameService,
    private readonly authService: AuthService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.socketEventCounts.delete(client.id);

    const res = this.gameService.handleDisconnect(
      client.id,
      (expiredPin) => {
        this.server
          .to(expiredPin)
          .emit('room_closed', { message: 'Host disconnected. Game room closed.' });
        this.gameService.closeRoom(expiredPin);
      },
      (lobbyPin) => {
        this.emitPlayerList(lobbyPin);
      },
    );

    if (!res.pin) return;

    if (res.role === 'host') {
      this.server.to(res.pin).emit('host_status', { connected: false });
      return;
    }

    if (res.role === 'player') {
      this.emitPlayerList(res.pin);
      if (res.shouldFinishQuestion) {
        this.finishCurrentQuestion(res.pin);
      }
    }
  }

  private checkRateLimit(socketId: string, maxPerWindow = 20): boolean {
    const now = Date.now();
    const record = this.socketEventCounts.get(socketId);
    if (!record || now - record.windowStart > 10_000) {
      this.socketEventCounts.set(socketId, { count: 1, windowStart: now });
      return true;
    }
    record.count++;
    return record.count <= maxPerWindow;
  }

  private emitPlayerList(pin: string): void {
    const list = this.gameService.getPlayerList(pin);
    this.server.to(pin).emit('player_list_updated', list);
  }

  private finishCurrentQuestion(pin: string): void {
    const results = this.gameService.getQuestionResults(pin);
    if (!results) return;

    // Broadcast public summary (without leaking private player feedback map)
    this.server.to(pin).emit('question_results', {
      correctOptionId: results.correctOptionId,
      correctOptionIds: results.correctOptionIds,
      optionCounts: results.optionCounts,
      leaderboard: results.leaderboard,
    });

    // Send private round result, streak, and rank directly to each connected player
    for (const feedback of results.playerFeedback) {
      if (!feedback.socketId) continue;
      this.server.to(feedback.socketId).emit('answer_result', {
        isCorrect: feedback.isCorrect,
        points: feedback.points,
        totalScore: feedback.totalScore,
        streak: feedback.streak,
        rank: feedback.rank,
        timedOut: feedback.timedOut,
      });
    }
  }

  private startAndBroadcastQuestion(pin: string): boolean {
    const publicQuestion = this.gameService.startQuestion(pin, () => {
      this.finishCurrentQuestion(pin);
    });

    if (!publicQuestion) return false;
    this.server.to(pin).emit('question_started', publicQuestion);
    return true;
  }

  @SubscribeMessage('create_room')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { quizId?: string; authToken?: string } | undefined,
  ): Promise<void> {
    if (!this.checkRateLimit(client.id, 10)) {
      client.emit('error_message', 'Too many requests. Please slow down.');
      return;
    }
    if (!data || typeof data.quizId !== 'string' || !data.quizId.trim()) {
      client.emit('error_message', 'Valid quizId is required.');
      return;
    }

    let hostUserId: string | undefined;
    if (typeof data.authToken === 'string' && data.authToken.trim()) {
      try {
        hostUserId = this.authService.verifyToken(data.authToken.trim()).id;
      } catch {
        // Optional auth token on create_room
      }
    }

    const result = await this.gameService.createRoom(
      data.quizId.trim(),
      client.id,
      hostUserId,
    );

    if (!result.room) {
      client.emit(
        'error_message',
        result.error || 'Could not create room for this quiz.',
      );
      return;
    }

    await client.join(result.room.pin);
    client.emit('room_created', {
      pin: result.room.pin,
      hostToken: result.room.hostToken,
      quizTitle: result.room.quiz.title,
      totalQuestions: result.room.quiz.questions.length,
    });
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string; nickname?: string } | undefined,
  ): Promise<void> {
    if (!this.checkRateLimit(client.id, 15)) {
      client.emit('join_failed', {
        message: 'Too many join attempts. Please wait a moment.',
      });
      return;
    }

    if (!data || typeof data.pin !== 'string' || typeof data.nickname !== 'string') {
      client.emit('join_failed', {
        message: 'PIN and nickname are required.',
      });
      return;
    }

    const pin = data.pin.trim();
    const res = this.gameService.joinRoom(pin, data.nickname, client.id);
    if (!res.success || !res.participant) {
      client.emit('join_failed', { message: res.message || 'Unable to join room.' });
      return;
    }

    await client.join(pin);
    client.emit('join_success', {
      pin,
      playerId: res.participant.playerId,
      playerToken: res.participant.playerToken,
      nickname: res.participant.nickname,
    });

    this.emitPlayerList(pin);
  }

  @SubscribeMessage('rejoin_room')
  async handleRejoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string; token?: string } | undefined,
  ): Promise<void> {
    if (!data || typeof data.pin !== 'string' || typeof data.token !== 'string') {
      client.emit('rejoin_failed', { message: 'Missing reconnect credentials.' });
      return;
    }

    const pin = data.pin.trim();
    const res = this.gameService.rejoinRoom(pin, data.token.trim(), client.id);
    if (!res.success) {
      client.emit('rejoin_failed', { message: res.message });
      return;
    }

    await client.join(pin);
    client.emit('rejoin_success', res);

    if (res.role === 'host') {
      this.server.to(pin).emit('host_status', { connected: true });
    } else {
      this.emitPlayerList(pin);
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string } | undefined,
  ): Promise<void> {
    const res = this.gameService.leaveRoomExplicit(client.id);
    const pin = res.pin || data?.pin;
    if (pin) {
      await client.leave(pin);
    }

    if (!res.pin) return;

    if (res.roomClosed) {
      this.server.to(res.pin).emit('room_closed', {
        message: 'Host ended the game session.',
      });
      return;
    }

    this.emitPlayerList(res.pin);
    if (res.shouldFinishQuestion) {
      this.finishCurrentQuestion(res.pin);
    }
  }

  @SubscribeMessage('start_game')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string } | undefined,
  ): void {
    if (!data || typeof data.pin !== 'string') return;
    const room = this.gameService.getRoom(data.pin.trim());
    if (!room || room.hostSocketId !== client.id || room.status !== 'LOBBY') {
      return;
    }

    if (room.participants.size === 0) {
      client.emit('error_message', 'Wait for at least 1 player to join before starting.');
      return;
    }

    this.startAndBroadcastQuestion(room.pin);
  }

  @SubscribeMessage('submit_answer')
  handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string; optionId?: string } | undefined,
  ): void {
    if (!data || typeof data.pin !== 'string' || typeof data.optionId !== 'string') {
      return;
    }

    const pin = data.pin.trim();
    const res = this.gameService.submitAnswer(
      pin,
      client.id,
      data.optionId.trim(),
    );
    if (!res.success) {
      if (res.message) {
        client.emit('error_message', res.message);
      }
      return;
    }

    // Confirm lock-in without revealing isCorrect early so players cannot share answers mid-round
    client.emit('answer_received', { accepted: true });

    this.server.to(pin).emit('answer_count_updated', {
      answerCount: res.answerCount,
      totalPlayers: res.totalPlayers,
    });

    if (res.allAnswered) {
      this.finishCurrentQuestion(pin);
    }
  }

  @SubscribeMessage('show_results')
  handleShowResults(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string } | undefined,
  ): void {
    if (!data || typeof data.pin !== 'string') return;
    const pin = data.pin.trim();
    const room = this.gameService.getRoom(pin);
    if (
      !room ||
      room.hostSocketId !== client.id ||
      room.status !== 'QUESTION_ACTIVE'
    ) {
      return;
    }

    this.finishCurrentQuestion(pin);
  }

  @SubscribeMessage('next_question')
  handleNextQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin?: string } | undefined,
  ): void {
    if (!data || typeof data.pin !== 'string') return;
    const pin = data.pin.trim();
    const room = this.gameService.getRoom(pin);
    if (
      !room ||
      room.hostSocketId !== client.id ||
      room.status !== 'QUESTION_RESULT'
    ) {
      return;
    }

    const advance = this.gameService.nextQuestion(pin);
    if (!advance) return;

    if (advance.isFinished) {
      this.server.to(pin).emit('game_over', {
        podium: advance.podium || [],
      });

      for (const standing of advance.finalStandings || []) {
        if (!standing.socketId) continue;
        this.server.to(standing.socketId).emit('player_game_over', {
          finalRank: standing.rank,
          totalScore: standing.score,
          totalPlayers: advance.finalStandings?.length || 0,
        });
      }
    } else {
      this.startAndBroadcastQuestion(pin);
    }
  }
}
