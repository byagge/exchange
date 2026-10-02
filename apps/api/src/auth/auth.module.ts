import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthGuard, JwtAuthGuard } from './guards';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'dev-secret',
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '7d') as any },
      }),
    }),
    UsersModule,
    LedgerModule,
    PrismaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, AdminAuthGuard],
  exports: [AuthService, JwtAuthGuard, AdminAuthGuard],
})
export class AuthModule {}
