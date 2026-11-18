import { BadRequestException } from '@nestjs/common';

export interface ValidatedOptionInput {
  content: string;
  isCorrect: boolean;
  colorCode?: string;
}

export interface ValidatedQuestionInput {
  prompt: string;
  questionType: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  timeLimitSeconds: number;
  points: number;
  mediaUrl?: string;
  options: ValidatedOptionInput[];
}

export interface ValidatedQuizInput {
  title: string;
  description: string;
  coverImageUrl?: string;
  isPublic: boolean;
  questions: ValidatedQuestionInput[];
}

const DEFAULT_OPTION_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#a855f7',
  '#ec4899',
];

function sanitizeOptionalUrl(
  rawUrl: unknown,
  fieldName: string,
): string | undefined {
  if (rawUrl === undefined || rawUrl === null) return undefined;
  if (typeof rawUrl !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string.`);
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 500) {
    throw new BadRequestException(`${fieldName} must be 500 characters or less.`);
  }
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) {
    throw new BadRequestException(
      `${fieldName} must start with http://, https://, or /.`,
    );
  }
  return trimmed;
}

export function validateQuizInput(rawBody: unknown): ValidatedQuizInput {
  if (!rawBody || typeof rawBody !== 'object') {
    throw new BadRequestException('Invalid quiz payload.');
  }

  const body = rawBody as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 120) {
    throw new BadRequestException('Quiz title must be between 1 and 120 characters.');
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 500) {
    throw new BadRequestException('Description must be 500 characters or less.');
  }

  const coverImageUrl = sanitizeOptionalUrl(body.coverImageUrl, 'coverImageUrl');
  const isPublic = body.isPublic === undefined ? true : Boolean(body.isPublic);

  if (!Array.isArray(body.questions) || body.questions.length < 1) {
    throw new BadRequestException('Quiz must contain at least 1 question.');
  }
  if (body.questions.length > 100) {
    throw new BadRequestException('Quiz cannot exceed 100 questions.');
  }

  const questions: ValidatedQuestionInput[] = body.questions.map(
    (rawQuestion, qIdx) => {
      if (!rawQuestion || typeof rawQuestion !== 'object') {
        throw new BadRequestException(`Question ${qIdx + 1} is invalid.`);
      }

      const q = rawQuestion as Record<string, unknown>;
      const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
      if (prompt.length < 1 || prompt.length > 500) {
        throw new BadRequestException(
          `Question ${qIdx + 1} prompt must be between 1 and 500 characters.`,
        );
      }

      const questionType =
        q.questionType === 'TRUE_FALSE' ? 'TRUE_FALSE' : 'MULTIPLE_CHOICE';

      const timeLimitSeconds =
        q.timeLimitSeconds === undefined ? 20 : Number(q.timeLimitSeconds);
      if (
        !Number.isInteger(timeLimitSeconds) ||
        timeLimitSeconds < 5 ||
        timeLimitSeconds > 300
      ) {
        throw new BadRequestException(
          `Question ${qIdx + 1} timeLimitSeconds must be an integer between 5 and 300.`,
        );
      }

      const points = q.points === undefined ? 1000 : Number(q.points);
      if (!Number.isInteger(points) || points < 100 || points > 10000) {
        throw new BadRequestException(
          `Question ${qIdx + 1} points must be an integer between 100 and 10000.`,
        );
      }

      const mediaUrl = sanitizeOptionalUrl(q.mediaUrl, `Question ${qIdx + 1} mediaUrl`);

      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        throw new BadRequestException(
          `Question ${qIdx + 1} must have between 2 and 6 options.`,
        );
      }

      const options: ValidatedOptionInput[] = q.options.map((rawOpt, oIdx) => {
        if (!rawOpt || typeof rawOpt !== 'object') {
          throw new BadRequestException(
            `Question ${qIdx + 1}, Option ${oIdx + 1} is invalid.`,
          );
        }
        const opt = rawOpt as Record<string, unknown>;
        const content = typeof opt.content === 'string' ? opt.content.trim() : '';
        if (content.length < 1 || content.length > 200) {
          throw new BadRequestException(
            `Question ${qIdx + 1}, Option ${oIdx + 1} cannot be empty (max 200 chars).`,
          );
        }

        const colorCode =
          typeof opt.colorCode === 'string' && opt.colorCode.trim()
            ? opt.colorCode.trim()
            : DEFAULT_OPTION_COLORS[oIdx % DEFAULT_OPTION_COLORS.length];

        return {
          content,
          isCorrect: Boolean(opt.isCorrect),
          colorCode,
        };
      });

      if (!options.some((opt) => opt.isCorrect)) {
        throw new BadRequestException(
          `Question ${qIdx + 1} must have at least one correct option.`,
        );
      }

      return {
        prompt,
        questionType,
        timeLimitSeconds,
        points,
        mediaUrl,
        options,
      };
    },
  );

  return {
    title,
    description,
    coverImageUrl,
    isPublic,
    questions,
  };
}
