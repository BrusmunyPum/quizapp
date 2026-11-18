import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { validateQuizInput } from '../src/quizzes/quizzes.validation';
import { QuizzesService, QuizData } from '../src/quizzes/quizzes.service';
import { GameService } from '../src/game/game.service';
import { PrismaService } from '../src/prisma/prisma.service';

function createStubPrisma(): PrismaService {
  return {
    isDbConnected: () => false,
    checkHealth: async () => false,
  } as unknown as PrismaService;
}

describe('AuthService', () => {
  const authService = new AuthService(createStubPrisma());

  it('hashes and verifies passwords with scrypt', () => {
    const hash = authService.hashPassword('StrongPass123!');
    assert.ok(hash.includes(':'));
    assert.equal(authService.verifyPassword('StrongPass123!', hash), true);
    assert.equal(authService.verifyPassword('WrongPass123!', hash), false);
  });

  it('signs and verifies HS256 JWT tokens and rejects tampering', () => {
    const token = authService.signToken({
      id: 'user-1',
      email: 'host@example.com',
      displayName: 'Host One',
    });

    const user = authService.verifyToken(token);
    assert.equal(user.id, 'user-1');
    assert.equal(user.email, 'host@example.com');
    assert.equal(user.displayName, 'Host One');

    const tampered = `${token.slice(0, -4)}xxxx`;
    assert.throws(() => authService.verifyToken(tampered), UnauthorizedException);
  });

  it('rejects expired JWT tokens', () => {
    const expiredToken = authService.signToken(
      { id: 'user-1', email: 'host@example.com', displayName: 'Host' },
      -10,
    );
    assert.throws(() => authService.verifyToken(expiredToken), UnauthorizedException);
  });
});

describe('Quiz Validation & Public Sanitization', () => {
  it('strips isCorrect from public quiz responses', () => {
    const quizzesService = new QuizzesService(createStubPrisma());
    const fullQuiz: QuizData = {
      id: 'q1',
      creatorId: 'user-1',
      title: 'Test Quiz',
      description: 'Desc',
      isPublic: true,
      questions: [
        {
          id: 'quest-1',
          prompt: '2+2?',
          questionType: 'MULTIPLE_CHOICE',
          timeLimitSeconds: 20,
          points: 1000,
          options: [
            { id: 'o1', content: '3', isCorrect: false },
            { id: 'o2', content: '4', isCorrect: true },
          ],
        },
      ],
    };

    const publicQuiz = quizzesService.toPublicQuiz(fullQuiz);
    assert.equal(
      'isCorrect' in (publicQuiz.questions[0].options[0] as unknown as Record<string, unknown>),
      false,
    );
    assert.equal(
      'isCorrect' in (publicQuiz.questions[0].options[1] as unknown as Record<string, unknown>),
      false,
    );
  });

  it('rejects invalid quiz payloads and unsafe URLs', () => {
    assert.throws(
      () => validateQuizInput({ title: '', questions: [] }),
      BadRequestException,
    );

    assert.throws(
      () =>
        validateQuizInput({
          title: 'Bad URL Quiz',
          coverImageUrl: 'javascript:alert(1)',
          questions: [
            {
              prompt: 'Q1',
              timeLimitSeconds: 20,
              points: 1000,
              options: [
                { content: 'A', isCorrect: true },
                { content: 'B', isCorrect: false },
              ],
            },
          ],
        }),
      BadRequestException,
    );

    assert.throws(
      () =>
        validateQuizInput({
          title: 'No Correct Option',
          questions: [
            {
              prompt: 'Q1',
              timeLimitSeconds: 20,
              points: 1000,
              options: [
                { content: 'A', isCorrect: false },
                { content: 'B', isCorrect: false },
              ],
            },
          ],
        }),
      BadRequestException,
    );
  });
});

describe('GameService Live Engine', () => {
  it('runs a full room lifecycle with scoring, state guards, and reconnection', async () => {
    const prisma = createStubPrisma();
    const quizzesService = new QuizzesService(prisma);
    const gameService = new GameService(quizzesService, prisma);

    try {
      const created = await gameService.createRoom('quiz-web-dev', 'host-sock-1');
      assert.ok(created.room);
      const pin = created.room.pin;
      const hostToken = created.room.hostToken;

      // Reject blank and invalid PIN/nicknames
      assert.equal(gameService.joinRoom('123', 'Alex', 'p1').success, false);
      assert.equal(gameService.joinRoom(pin, '   ', 'p1').success, false);

      const j1 = gameService.joinRoom(pin, 'Alice', 'p1-sock');
      const j2 = gameService.joinRoom(pin, 'Bob', 'p2-sock');
      assert.equal(j1.success, true);
      assert.equal(j2.success, true);

      // Duplicate nickname check (case-insensitive)
      assert.equal(gameService.joinRoom(pin, 'alice', 'p3-sock').success, false);

      // Start Q1
      const q1 = gameService.startQuestion(pin);
      assert.ok(q1);
      assert.equal(q1.questionNumber, 1);

      // Submit answers (opt1 is correct, opt2 is incorrect on starter quiz q1)
      const sub1 = gameService.submitAnswer(pin, 'p1-sock', 'opt1');
      assert.equal(sub1.success, true);
      assert.equal(sub1.allAnswered, false);

      // Duplicate answer rejected
      const dup = gameService.submitAnswer(pin, 'p1-sock', 'opt1');
      assert.equal(dup.success, false);

      // Player 2 disconnects before answering -> remaining connected players all answered
      const disc = gameService.handleDisconnect('p2-sock');
      assert.equal(disc.shouldFinishQuestion, true);

      const results1 = gameService.getQuestionResults(pin);
      assert.ok(results1);
      assert.equal(results1.correctOptionId, 'opt1');
      assert.equal(results1.leaderboard[0].nickname, 'Alice');
      assert.ok(results1.leaderboard[0].score >= 500);

      // Calling getQuestionResults twice in QUESTION_RESULT is idempotent/null
      assert.equal(gameService.getQuestionResults(pin), null);

      // Player 2 rejoins with playerToken
      const rejoin = gameService.rejoinRoom(pin, j2.participant!.playerToken, 'p2-sock-new');
      assert.equal(rejoin.success, true);
      if (rejoin.success) {
        assert.equal(rejoin.role, 'player');
        assert.equal(rejoin.gameState, 'result');
      }

      // Host rejoins with hostToken
      const hostRejoin = gameService.rejoinRoom(pin, hostToken, 'host-sock-2');
      assert.equal(hostRejoin.success, true);
      if (hostRejoin.success) {
        assert.equal(hostRejoin.role, 'host');
      }
    } finally {
      gameService.onModuleDestroy();
    }
  });

  it('rejects late answers past question time limit', async () => {
    const prisma = createStubPrisma();
    const quizzesService = new QuizzesService(prisma);
    const gameService = new GameService(quizzesService, prisma);

    try {
      const created = await gameService.createRoom('quiz-web-dev', 'host-sock');
      const room = created.room!;
      gameService.joinRoom(room.pin, 'LatePlayer', 'p-sock');
      gameService.startQuestion(room.pin);

      // Backdate questionStartTime past 20s + 500ms grace
      room.questionStartTime = Date.now() - 25_000;

      const lateRes = gameService.submitAnswer(room.pin, 'p-sock', 'opt1');
      assert.equal(lateRes.success, false);
      assert.equal(lateRes.message, 'Time expired for this question.');
    } finally {
      gameService.onModuleDestroy();
    }
  });
});
