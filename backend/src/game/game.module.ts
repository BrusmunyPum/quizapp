import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { QuizzesModule } from '../quizzes/quizzes.module';

@Module({
  imports: [QuizzesModule],
  providers: [GameGateway, GameService],
  exports: [GameService],
})
export class GameModule {}
