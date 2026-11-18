import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config/env';
import type {
  AnswerResult,
  LeaderboardEntry,
  PodiumEntry,
  Player,
  Question,
} from '../types/quiz';

const SESSION_STORAGE_KEY = 'glassquiz_room_session';

interface StoredRoomSession {
  pin: string;
  token: string;
  role: 'host' | 'player';
}

export const useGameStore = defineStore('game', () => {
  const socket = ref<Socket | null>(null);
  const isConnected = ref(false);

  // User role: 'none' | 'host' | 'player'
  const role = ref<'none' | 'host' | 'player'>('none');

  // Room & Player info
  const roomPin = ref<string>('');
  const quizTitle = ref<string>('');
  const playerNickname = ref<string>('');
  const players = ref<Player[]>([]);
  const hostConnected = ref(true);

  // Game state: 'idle' | 'lobby' | 'question' | 'result' | 'podium'
  const gameState = ref<'idle' | 'lobby' | 'question' | 'result' | 'podium'>('idle');

  // Question & Timer
  const currentQuestion = ref<Question | null>(null);
  const timeRemaining = ref<number>(0);
  const timerInterval = ref<number | null>(null);

  // Player answer state
  const selectedOptionId = ref<string | null>(null);
  const hasSubmittedAnswer = ref(false);
  const answerResult = ref<AnswerResult | null>(null);
  const playerScore = ref(0);
  const playerStreak = ref(0);
  const playerRank = ref<number | null>(null);
  const finalRank = ref<number | null>(null);
  const finalTotalPlayers = ref<number | null>(null);

  // Host live stats
  const answerCount = ref(0);
  const totalPlayersInRoom = ref(0);

  // Results & Podium
  const questionResults = ref<{
    correctOptionId?: string;
    correctOptionIds?: string[];
    optionCounts?: Record<string, number>;
    leaderboard?: LeaderboardEntry[];
  } | null>(null);
  const podium = ref<PodiumEntry[]>([]);
  const errorMessage = ref<string | null>(null);

  const isHost = computed(() => role.value === 'host');
  const isPlayer = computed(() => role.value === 'player');

  function saveRoomSession(session: StoredRoomSession) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  function loadRoomSession(): StoredRoomSession | null {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredRoomSession>;
      if (parsed.pin && parsed.token && (parsed.role === 'host' || parsed.role === 'player')) {
        return parsed as StoredRoomSession;
      }
      return null;
    } catch {
      return null;
    }
  }

  function clearRoomSession() {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function initSocket(customWsUrl?: string) {
    if (socket.value) return;

    const targetUrl = customWsUrl ?? WS_URL;
    socket.value = targetUrl
      ? io(targetUrl, {
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 10,
        })
      : io({
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 10,
        });

    socket.value.on('connect', () => {
      isConnected.value = true;
      const saved = loadRoomSession();
      if (saved) {
        socket.value?.emit('rejoin_room', {
          pin: saved.pin,
          token: saved.token,
        });
      }
    });

    socket.value.on('disconnect', () => {
      isConnected.value = false;
    });

    socket.value.on(
      'room_created',
      (data: { pin: string; hostToken: string; quizTitle: string }) => {
        roomPin.value = data.pin;
        quizTitle.value = data.quizTitle;
        role.value = 'host';
        gameState.value = 'lobby';
        hostConnected.value = true;
        players.value = [];
        errorMessage.value = null;
        saveRoomSession({ pin: data.pin, token: data.hostToken, role: 'host' });
      },
    );

    socket.value.on(
      'join_success',
      (data: { pin: string; playerToken: string; nickname: string }) => {
        roomPin.value = data.pin;
        playerNickname.value = data.nickname;
        role.value = 'player';
        gameState.value = 'lobby';
        hostConnected.value = true;
        errorMessage.value = null;
        saveRoomSession({
          pin: data.pin,
          token: data.playerToken,
          role: 'player',
        });
      },
    );

    socket.value.on(
      'rejoin_success',
      (data: {
        role: 'host' | 'player';
        pin: string;
        quizTitle: string;
        gameState: 'lobby' | 'question' | 'result' | 'podium';
        players: Player[];
        currentQuestion?: Question;
        answerCount: number;
        totalPlayers: number;
        questionResults?: {
          correctOptionId?: string;
          correctOptionIds?: string[];
          optionCounts?: Record<string, number>;
          leaderboard?: LeaderboardEntry[];
        };
        podium?: PodiumEntry[];
        nickname?: string;
        playerScore?: number;
        playerRank?: number;
        playerStreak?: number;
        hasSubmittedAnswer?: boolean;
        selectedOptionId?: string | null;
        answerResult?: AnswerResult | null;
      }) => {
        role.value = data.role;
        roomPin.value = data.pin;
        quizTitle.value = data.quizTitle;
        gameState.value = data.gameState;
        players.value = data.players || [];
        totalPlayersInRoom.value = data.totalPlayers || data.players?.length || 0;
        answerCount.value = data.answerCount || 0;
        currentQuestion.value = data.currentQuestion || null;
        questionResults.value = data.questionResults || null;
        podium.value = data.podium || [];
        errorMessage.value = null;
        hostConnected.value = true;

        if (data.role === 'player') {
          playerNickname.value = data.nickname || '';
          playerScore.value = data.playerScore || 0;
          playerRank.value = data.playerRank ?? null;
          playerStreak.value = data.playerStreak || 0;
          hasSubmittedAnswer.value = Boolean(data.hasSubmittedAnswer);
          selectedOptionId.value = data.selectedOptionId ?? null;
          answerResult.value = data.answerResult ?? null;
        }

        if (data.gameState === 'question' && data.currentQuestion) {
          startTimer(
            data.currentQuestion.timeLimitSeconds,
            data.currentQuestion.endsAt,
          );
        } else {
          stopTimer();
        }
      },
    );

    socket.value.on('rejoin_failed', () => {
      clearLocalSessionState();
    });

    socket.value.on('join_failed', (data: { message: string }) => {
      errorMessage.value = data.message;
    });

    socket.value.on('error_message', (msg: string) => {
      errorMessage.value = msg;
    });

    socket.value.on('host_status', (data: { connected: boolean }) => {
      hostConnected.value = data.connected;
    });

    socket.value.on('room_closed', (data: { message?: string }) => {
      const msg = data?.message || 'Game room has closed.';
      clearLocalSessionState();
      errorMessage.value = msg;
    });

    socket.value.on('player_list_updated', (list: Player[]) => {
      players.value = list;
      totalPlayersInRoom.value = list.length;
    });

    socket.value.on('question_started', (q: Question) => {
      currentQuestion.value = q;
      gameState.value = 'question';
      selectedOptionId.value = null;
      hasSubmittedAnswer.value = false;
      answerResult.value = null;
      answerCount.value = 0;
      errorMessage.value = null;

      startTimer(q.timeLimitSeconds, q.endsAt);
    });

    socket.value.on('answer_received', () => {
      hasSubmittedAnswer.value = true;
    });

    socket.value.on('answer_result', (res: AnswerResult) => {
      answerResult.value = res;
      if (typeof res.totalScore === 'number') {
        playerScore.value = res.totalScore;
      } else if (res.isCorrect) {
        playerScore.value += res.points;
      }
      if (typeof res.streak === 'number') {
        playerStreak.value = res.streak;
      }
      if (typeof res.rank === 'number') {
        playerRank.value = res.rank;
      }
    });

    socket.value.on(
      'answer_count_updated',
      (data: { answerCount: number; totalPlayers: number }) => {
        answerCount.value = data.answerCount;
        totalPlayersInRoom.value = data.totalPlayers;
      },
    );

    socket.value.on('question_results', (results) => {
      stopTimer();
      questionResults.value = results;
      gameState.value = 'result';
    });

    socket.value.on('game_over', (data: { podium: PodiumEntry[] }) => {
      stopTimer();
      podium.value = data.podium || [];
      gameState.value = 'podium';
      clearRoomSession();
    });

    socket.value.on(
      'player_game_over',
      (data: { finalRank: number; totalScore: number; totalPlayers: number }) => {
        finalRank.value = data.finalRank;
        playerScore.value = data.totalScore;
        finalTotalPlayers.value = data.totalPlayers;
      },
    );
  }

  function startTimer(seconds: number, endsAt?: number) {
    stopTimer();
    const targetEnd = endsAt ?? Date.now() + seconds * 1000;

    const update = () => {
      const remaining = Math.max(0, Math.ceil((targetEnd - Date.now()) / 1000));
      timeRemaining.value = remaining;
      if (remaining <= 0) {
        stopTimer();
      }
    };

    update();
    timerInterval.value = window.setInterval(update, 250);
  }

  function stopTimer() {
    if (timerInterval.value !== null) {
      clearInterval(timerInterval.value);
      timerInterval.value = null;
    }
  }

  function createRoom(quizId: string, authToken?: string | null) {
    initSocket();
    errorMessage.value = null;
    socket.value?.emit('create_room', { quizId, authToken });
  }

  function joinRoom(pin: string, nickname: string) {
    initSocket();
    errorMessage.value = null;
    socket.value?.emit('join_room', { pin, nickname });
  }

  function startGame() {
    if (!roomPin.value) return;
    errorMessage.value = null;
    socket.value?.emit('start_game', { pin: roomPin.value });
  }

  function endQuestionEarly() {
    if (!roomPin.value || !isHost.value) return;
    socket.value?.emit('show_results', { pin: roomPin.value });
  }

  function submitAnswer(optionId: string) {
    if (!roomPin.value || hasSubmittedAnswer.value || timeRemaining.value <= 0) {
      return;
    }
    selectedOptionId.value = optionId;
    hasSubmittedAnswer.value = true;
    socket.value?.emit('submit_answer', { pin: roomPin.value, optionId });
  }

  function nextQuestion() {
    if (!roomPin.value) return;
    socket.value?.emit('next_question', { pin: roomPin.value });
  }

  function clearLocalSessionState() {
    stopTimer();
    clearRoomSession();
    role.value = 'none';
    roomPin.value = '';
    quizTitle.value = '';
    playerNickname.value = '';
    players.value = [];
    hostConnected.value = true;
    gameState.value = 'idle';
    currentQuestion.value = null;
    selectedOptionId.value = null;
    hasSubmittedAnswer.value = false;
    answerResult.value = null;
    playerScore.value = 0;
    playerStreak.value = 0;
    playerRank.value = null;
    finalRank.value = null;
    finalTotalPlayers.value = null;
    answerCount.value = 0;
    totalPlayersInRoom.value = 0;
    questionResults.value = null;
    podium.value = [];
  }

  function resetGame() {
    if (roomPin.value) {
      socket.value?.emit('leave_room', { pin: roomPin.value });
    }
    clearLocalSessionState();
    errorMessage.value = null;
  }

  return {
    socket,
    isConnected,
    role,
    roomPin,
    quizTitle,
    playerNickname,
    players,
    hostConnected,
    gameState,
    currentQuestion,
    timeRemaining,
    selectedOptionId,
    hasSubmittedAnswer,
    answerResult,
    playerScore,
    playerStreak,
    playerRank,
    finalRank,
    finalTotalPlayers,
    answerCount,
    totalPlayersInRoom,
    questionResults,
    podium,
    errorMessage,
    isHost,
    isPlayer,
    initSocket,
    createRoom,
    joinRoom,
    startGame,
    endQuestionEarly,
    submitAnswer,
    nextQuestion,
    resetGame,
  };
});
