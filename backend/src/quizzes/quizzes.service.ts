import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STARTER_QUIZZES,
  seedStarterQuizzesIfEmpty,
} from './starter-quizzes';
import { validateQuizInput } from './quizzes.validation';

export interface OptionData {
  id: string;
  content: string;
  isCorrect: boolean;
  colorCode?: string;
}

export interface PublicOptionData {
  id: string;
  content: string;
  colorCode?: string;
}

export interface QuestionData {
  id: string;
  prompt: string;
  questionType: string;
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: OptionData[];
}

export interface PublicQuestionData {
  id: string;
  prompt: string;
  questionType: string;
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: PublicOptionData[];
}

export interface QuizData {
  id: string;
  creatorId: string;
  creatorName?: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  isPublic: boolean;
  questions: QuestionData[];
}

export interface PublicQuizData {
  id: string;
  creatorId: string;
  creatorName?: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  isPublic: boolean;
  questions: PublicQuestionData[];
}

const QUIZ_INCLUDE = {
  creator: {
    select: {
      id: true,
      displayName: true,
    },
  },
  questions: {
    orderBy: { orderIndex: 'asc' as const },
    include: {
      options: {
        orderBy: { orderIndex: 'asc' as const },
      },
    },
  },
} satisfies Prisma.QuizInclude;

type DbQuizWithRelations = Prisma.QuizGetPayload<{ include: typeof QUIZ_INCLUDE }>;

@Injectable()
export class QuizzesService implements OnModuleInit {
  private readonly logger = new Logger(QuizzesService.name);

  // Used strictly when PostgreSQL is unavailable and REQUIRE_DB=false
  private fallbackQuizzes: QuizData[] = STARTER_QUIZZES.map((q) => ({
    ...q,
    creatorId: 'system',
    creatorName: 'GlassQuiz Library',
    isPublic: true,
  }));

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (!this.prisma.isDbConnected()) return;

    try {
      const seeded = await seedStarterQuizzesIfEmpty(this.prisma);
      if (seeded) {
        this.logger.log('Seeded starter quizzes into PostgreSQL');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to seed starter quizzes: ${msg}`);
    }
  }

  private mapDbQuiz(quiz: DbQuizWithRelations): QuizData {
    return {
      id: quiz.id,
      creatorId: quiz.creatorId,
      creatorName: quiz.creator?.displayName,
      title: quiz.title,
      description: quiz.description || '',
      coverImageUrl: quiz.coverImageUrl ?? undefined,
      isPublic: quiz.isPublic,
      questions: quiz.questions.map((quest) => ({
        id: quest.id,
        prompt: quest.prompt,
        questionType: quest.questionType,
        timeLimitSeconds: quest.timeLimitSeconds,
        points: quest.points,
        mediaUrl: quest.mediaUrl ?? undefined,
        options: quest.options.map((opt) => ({
          id: opt.id,
          content: opt.content,
          isCorrect: opt.isCorrect,
          colorCode: opt.colorCode ?? undefined,
        })),
      })),
    };
  }

  /**
   * Strips isCorrect from every option before exposing quizzes publicly.
   */
  toPublicQuiz(quiz: QuizData): PublicQuizData {
    return {
      id: quiz.id,
      creatorId: quiz.creatorId,
      creatorName: quiz.creatorName,
      title: quiz.title,
      description: quiz.description,
      coverImageUrl: quiz.coverImageUrl,
      isPublic: quiz.isPublic,
      questions: quiz.questions.map((quest) => ({
        id: quest.id,
        prompt: quest.prompt,
        questionType: quest.questionType,
        timeLimitSeconds: quest.timeLimitSeconds,
        points: quest.points,
        mediaUrl: quest.mediaUrl,
        options: quest.options.map((opt) => ({
          id: opt.id,
          content: opt.content,
          colorCode: opt.colorCode,
        })),
      })),
    };
  }

  async findAllPublic(viewerId?: string): Promise<PublicQuizData[]> {
    if (!this.prisma.isDbConnected()) {
      return this.fallbackQuizzes
        .filter((q) => q.isPublic || (viewerId && q.creatorId === viewerId))
        .map((q) => this.toPublicQuiz(q));
    }

    const whereClause: Prisma.QuizWhereInput = viewerId
      ? { OR: [{ isPublic: true }, { creatorId: viewerId }] }
      : { isPublic: true };

    const dbQuizzes = await this.prisma.quiz.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: QUIZ_INCLUDE,
    });

    return dbQuizzes.map((q) => this.toPublicQuiz(this.mapDbQuiz(q)));
  }

  async findOnePublic(id: string, viewerId?: string): Promise<PublicQuizData | null> {
    const quiz = await this.findOneInternal(id);
    if (!quiz) return null;
    if (!quiz.isPublic && quiz.creatorId !== viewerId) {
      return null;
    }
    return this.toPublicQuiz(quiz);
  }

  async findOneForManage(id: string, userId: string): Promise<QuizData> {
    const quiz = await this.findOneInternal(id);
    if (!quiz) {
      throw new NotFoundException(`Quiz with id ${id} not found`);
    }
    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to edit this quiz.');
    }
    return quiz;
  }

  async findOneInternal(id: string): Promise<QuizData | null> {
    if (!this.prisma.isDbConnected()) {
      return this.fallbackQuizzes.find((q) => q.id === id) || null;
    }

    const dbQuiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: QUIZ_INCLUDE,
    });

    return dbQuiz ? this.mapDbQuiz(dbQuiz) : null;
  }

  async create(userId: string, rawBody: unknown): Promise<QuizData> {
    const validated = validateQuizInput(rawBody);

    if (!this.prisma.isDbConnected()) {
      const newQuiz: QuizData = {
        id: `quiz-${Date.now()}`,
        creatorId: userId,
        title: validated.title,
        description: validated.description,
        coverImageUrl: validated.coverImageUrl,
        isPublic: validated.isPublic,
        questions: validated.questions.map((q, qIdx) => ({
          id: `q-${Date.now()}-${qIdx}`,
          prompt: q.prompt,
          questionType: q.questionType,
          timeLimitSeconds: q.timeLimitSeconds,
          points: q.points,
          mediaUrl: q.mediaUrl,
          options: q.options.map((opt, oIdx) => ({
            id: `opt-${Date.now()}-${qIdx}-${oIdx}`,
            content: opt.content,
            isCorrect: opt.isCorrect,
            colorCode: opt.colorCode,
          })),
        })),
      };
      this.fallbackQuizzes.unshift(newQuiz);
      return newQuiz;
    }

    const created = await this.prisma.quiz.create({
      data: {
        creatorId: userId,
        title: validated.title,
        description: validated.description,
        coverImageUrl: validated.coverImageUrl,
        isPublic: validated.isPublic,
        questions: {
          create: validated.questions.map((q, qIndex) => ({
            prompt: q.prompt,
            questionType: q.questionType,
            timeLimitSeconds: q.timeLimitSeconds,
            points: q.points,
            orderIndex: qIndex,
            mediaUrl: q.mediaUrl,
            options: {
              create: q.options.map((opt, oIndex) => ({
                content: opt.content,
                isCorrect: opt.isCorrect,
                orderIndex: oIndex,
                colorCode: opt.colorCode,
              })),
            },
          })),
        },
      },
      include: QUIZ_INCLUDE,
    });

    return this.mapDbQuiz(created);
  }

  async update(id: string, userId: string, rawBody: unknown): Promise<QuizData> {
    const validated = validateQuizInput(rawBody);

    if (!this.prisma.isDbConnected()) {
      const idx = this.fallbackQuizzes.findIndex((q) => q.id === id);
      if (idx === -1) throw new NotFoundException(`Quiz with id ${id} not found`);
      if (this.fallbackQuizzes[idx].creatorId !== userId) {
        throw new ForbiddenException('You do not have permission to edit this quiz.');
      }

      const updated: QuizData = {
        ...this.fallbackQuizzes[idx],
        title: validated.title,
        description: validated.description,
        coverImageUrl: validated.coverImageUrl,
        isPublic: validated.isPublic,
        questions: validated.questions.map((q, qIdx) => ({
          id: `q-${Date.now()}-${qIdx}`,
          prompt: q.prompt,
          questionType: q.questionType,
          timeLimitSeconds: q.timeLimitSeconds,
          points: q.points,
          mediaUrl: q.mediaUrl,
          options: q.options.map((opt, oIdx) => ({
            id: `opt-${Date.now()}-${qIdx}-${oIdx}`,
            content: opt.content,
            isCorrect: opt.isCorrect,
            colorCode: opt.colorCode,
          })),
        })),
      };
      this.fallbackQuizzes[idx] = updated;
      return updated;
    }

    const existing = await this.prisma.quiz.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Quiz with id ${id} not found`);
    }
    if (existing.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to edit this quiz.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { quizId: id } });
      return tx.quiz.update({
        where: { id },
        data: {
          title: validated.title,
          description: validated.description,
          coverImageUrl: validated.coverImageUrl ?? null,
          isPublic: validated.isPublic,
          questions: {
            create: validated.questions.map((q, qIndex) => ({
              prompt: q.prompt,
              questionType: q.questionType,
              timeLimitSeconds: q.timeLimitSeconds,
              points: q.points,
              orderIndex: qIndex,
              mediaUrl: q.mediaUrl,
              options: {
                create: q.options.map((opt, oIndex) => ({
                  content: opt.content,
                  isCorrect: opt.isCorrect,
                  orderIndex: oIndex,
                  colorCode: opt.colorCode,
                })),
              },
            })),
          },
        },
        include: QUIZ_INCLUDE,
      });
    });

    return this.mapDbQuiz(updated);
  }

  async remove(id: string, userId: string): Promise<{ deleted: true; id: string }> {
    if (!this.prisma.isDbConnected()) {
      const idx = this.fallbackQuizzes.findIndex((q) => q.id === id);
      if (idx === -1) throw new NotFoundException(`Quiz with id ${id} not found`);
      if (this.fallbackQuizzes[idx].creatorId !== userId) {
        throw new ForbiddenException('You do not have permission to delete this quiz.');
      }
      this.fallbackQuizzes.splice(idx, 1);
      return { deleted: true, id };
    }

    const existing = await this.prisma.quiz.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Quiz with id ${id} not found`);
    }
    if (existing.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this quiz.');
    }

    await this.prisma.quiz.delete({ where: { id } });
    return { deleted: true, id };
  }
}
