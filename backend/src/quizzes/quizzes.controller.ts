import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  QuizzesService,
  PublicQuizData,
  QuizData,
} from './quizzes.service';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
} from '../auth/auth.guard';

@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getAllQuizzes(
    @Req() req: AuthenticatedRequest,
  ): Promise<PublicQuizData[]> {
    return this.quizzesService.findAllPublic(req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/manage')
  async getQuizForManage(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<QuizData> {
    return this.quizzesService.findOneForManage(id, req.user!.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getQuizById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PublicQuizData> {
    const quiz = await this.quizzesService.findOnePublic(id, req.user?.id);
    if (!quiz) {
      throw new NotFoundException(`Quiz with id ${id} not found`);
    }
    return quiz;
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createQuiz(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<PublicQuizData> {
    const created = await this.quizzesService.create(req.user!.id, body);
    return this.quizzesService.toPublicQuiz(created);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateQuiz(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<PublicQuizData> {
    const updated = await this.quizzesService.update(id, req.user!.id, body);
    return this.quizzesService.toPublicQuiz(updated);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteQuiz(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ deleted: true; id: string }> {
    return this.quizzesService.remove(id, req.user!.id);
  }
}
