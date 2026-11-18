import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService, AuthUser } from './auth.service';
import { AuthenticatedRequest, JwtAuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(
    @Body() body: { email?: string; password?: string; displayName?: string },
  ): Promise<{ accessToken: string; user: AuthUser }> {
    return this.authService.register(body || {});
  }

  @Post('login')
  login(
    @Body() body: { email?: string; password?: string },
  ): Promise<{ accessToken: string; user: AuthUser }> {
    return this.authService.login(body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest): { user: AuthUser | undefined } {
    return { user: req.user };
  }
}
