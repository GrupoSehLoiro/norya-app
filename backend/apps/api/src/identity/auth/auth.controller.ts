/**
 * AuthController — endpoints da API V2 (prefixo global `/api`).
 *
 * Rotas:
 *   POST /api/v2/auth/register      (public)  — sign-up, envia código
 *   POST /api/v2/auth/verify-email  (public)  — confirma email → emite JWT
 *   POST /api/v2/auth/resend-code   (public)  — reenvia código
 *   POST /api/v2/auth/login         (public)  — login (email|username)
 *   POST /api/v2/auth/refresh       (public)  — rotação de refresh
 *   POST /api/v2/auth/logout        (auth)    — revoga refresh
 *   GET  /api/v2/auth/me            (auth)    — contexto user + workspaces
 *   POST /api/v2/auth/workspace/:id/activate (auth) — troca workspace ativo
 */
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser, type AuthUser } from './decorators/current-user.decorator';
import { AuthService, AuthTokens, LoginResult, MeResult, RegisterResult } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

@Controller('v2/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  register(@Body(new ZodValidationPipe(RegisterDto)) dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailDto)) dto: VerifyEmailDto,
  ): Promise<LoginResult> {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Post('resend-code')
  @HttpCode(202)
  resendCode(
    @Body(new ZodValidationPipe(ResendCodeDto)) dto: ResendCodeDto,
  ): Promise<{ ok: true }> {
    return this.auth.resendCode(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginDto)) dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(RefreshDto)) dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(RefreshDto)) dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResult> {
    return this.auth.getMe(user.sub);
  }

  @Post('workspace/:id/activate')
  @HttpCode(200)
  activateWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('id') workspaceId: string,
  ): Promise<AuthTokens> {
    return this.auth.activateWorkspace(user.sub, workspaceId);
  }
}
