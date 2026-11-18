import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getEnvConfig } from '../config/env';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface JwtPayload extends AuthUser {
  iat: number;
  exp: number;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, expectedHex] = parts;
    if (!salt || !expectedHex) return false;

    try {
      const derived = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  signToken(user: AuthUser, ttlSeconds = TOKEN_TTL_SECONDS): string {
    const { jwtSecret } = getEnvConfig();
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        iat: now,
        exp: now + ttlSeconds,
      } satisfies JwtPayload),
    ).toString('base64url');

    const signature = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  verifyToken(token: string): AuthUser {
    const { jwtSecret } = getEnvConfig();
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid authentication token.');
    }

    const [header, payload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      throw new UnauthorizedException('Invalid token signature.');
    }

    let decoded: JwtPayload;
    try {
      decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Malformed authentication token.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!decoded.id || !decoded.email || typeof decoded.exp !== 'number' || decoded.exp <= now) {
      throw new UnauthorizedException('Authentication token expired.');
    }

    return {
      id: decoded.id,
      email: decoded.email,
      displayName: decoded.displayName,
    };
  }

  async register(input: {
    email?: string;
    password?: string;
    displayName?: string;
  }): Promise<{ accessToken: string; user: AuthUser }> {
    const email = (input.email || '').trim().toLowerCase();
    const password = input.password || '';
    const displayName = (input.displayName || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Please provide a valid email address.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException('Password must be between 8 and 128 characters.');
    }
    if (displayName.length < 2 || displayName.length > 50) {
      throw new BadRequestException('Display name must be between 2 and 50 characters.');
    }

    if (!this.prisma.isDbConnected()) {
      throw new BadRequestException('Database is offline; host registration requires PostgreSQL.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash: this.hashPassword(password),
        displayName,
      },
    });

    const user: AuthUser = {
      id: created.id,
      email: created.email,
      displayName: created.displayName,
    };

    return {
      accessToken: this.signToken(user),
      user,
    };
  }

  async login(input: {
    email?: string;
    password?: string;
  }): Promise<{ accessToken: string; user: AuthUser }> {
    const email = (input.email || '').trim().toLowerCase();
    const password = input.password || '';

    if (!email || !password) {
      throw new BadRequestException('Email and password are required.');
    }

    if (!this.prisma.isDbConnected()) {
      throw new BadRequestException('Database is offline; host login requires PostgreSQL.');
    }

    const userRecord = await this.prisma.user.findUnique({ where: { email } });
    if (!userRecord || !this.verifyPassword(password, userRecord.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const user: AuthUser = {
      id: userRecord.id,
      email: userRecord.email,
      displayName: userRecord.displayName,
    };

    return {
      accessToken: this.signToken(user),
      user,
    };
  }
}
