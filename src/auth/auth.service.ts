import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import {
  ACCESS_TOKEN_EXPIRED_IN,
  ACCESS_TOKEN_SECRET,
} from 'src/common/constants/constants';
import { CoreOutput } from 'src/common/dto/output.dto';
import { createError } from 'src/common/utils';
import { EmailService } from 'src/email/email.service';
import { User } from 'src/user/entities/user.entity';
import { DataSource, Repository } from 'typeorm';
import { SignUpInput, VerifyEmailInput, VerifyEmailOutput } from './dto';
import {
  ForgotPasswordInput,
  ForgotPasswordOutput,
} from './dto/forgotPassword.dto';
import {
  LoginInput,
  LoginOutPut,
  NewAccessTokenInput,
  NewAccessTokenOutput,
} from './dto/login.dto';
import {
  VerifyForgotPasswordInput,
  VerifyForgotPasswordOutput,
} from './dto/verifyForgotPassword';
import { Verification, VerificationType } from './entities/verification.entity';
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Verification)
    private readonly verificationRepo: Repository<Verification>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}
  async signUp({
    email,
    name,
    password,
    confirmPassword,
    role,
  }: SignUpInput): Promise<CoreOutput> {
    let user: User;
    try {
      if (password != confirmPassword)
        return createError('Repassword', 'Mật khẩu xác nhận không đúng');
      const existedUser = await this.userRepo.findOne({
        where: {
          email,
        },
      });
      if (existedUser)
        return createError('Email', 'Email đã được đăng kí trước đó');
      await this.dataSource.transaction(async (etm) => {
        user = await etm.save(
          this.userRepo.create({
            email,
            name,
            password,
            role,
          }),
        );
        await etm.save(
          this.verificationRepo.create({
            user,
            verificationType: VerificationType.EMAIL_VERIFICATION,
          }),
        );
        await this.emailService.sendConfirmEmail(
          email,
          jwt.sign(
            {
              userId: user.id,
            },
            this.configService.get<string>('VERIFY_TOKEN_SECRET'),
          ),
        );
      });
      return {
        ok: true,
      };
    } catch (err) {
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }
  async login({ email, password }: LoginInput): Promise<LoginOutPut> {
    try {
      const user = await this.userRepo.findOne({
        where: {
          email,
        },
        select: ['password', 'id', 'role', 'email', 'name'],
      });
      if (!user || !(await user.checkPassword(password)))
        return createError('Password', 'Email hoặc mật khẩu không đúng');
      const accessToken = jwt.sign(
        {
          userId: user.id,
        },
        this.configService.get<string>(ACCESS_TOKEN_SECRET),
        {
          expiresIn: this.configService.get<string>(ACCESS_TOKEN_EXPIRED_IN),
        },
      );
      return {
        ok: true,
        accessToken,
      };
    } catch (err) {
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }
  async newAccessToken({
    accessToken,
  }: NewAccessTokenInput): Promise<NewAccessTokenOutput> {
    try {
      const decoded = jwt.verify(
        accessToken,
        this.configService.get<string>(ACCESS_TOKEN_SECRET),
      );
      if (!decoded || !decoded['userId']) throw new jwt.JsonWebTokenError('');
      const newAccessToken = jwt.sign(
        {
          userId: decoded['userId'],
        },
        this.configService.get<string>(ACCESS_TOKEN_SECRET),
        {
          expiresIn: this.configService.get<string>(ACCESS_TOKEN_EXPIRED_IN),
        },
      );
      return {
        ok: true,
        accessToken: newAccessToken,
      };
    } catch (err) {
      if (err instanceof jwt.JsonWebTokenError)
        return createError('accessToken', 'Người dùng không hợp lệ!');
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }
  async forgotPassword({
    email,
  }: ForgotPasswordInput): Promise<ForgotPasswordOutput> {
    try {
      const user = await this.userRepo.findOneBy({ email });
      if (!user) return createError('Email', 'Tài khoản không tồn tại!');
      const verification = await this.verificationRepo.findOneBy({
        user: {
          id: user.id,
        },
        verificationType: VerificationType.FORGOT_PASSWORD_VERIFICATION,
      });
      if (!verification) {
        await this.verificationRepo.save(
          this.verificationRepo.create({
            user,
            verificationType: VerificationType.FORGOT_PASSWORD_VERIFICATION,
          }),
        );
      }
      await this.emailService.sendForgotPassword(
        email,
        jwt.sign(
          {
            userId: user.id,
          },
          this.configService.get<string>('VERIFY_TOKEN_SECRET'),
        ),
      );
      return {
        ok: true,
      };
    } catch (err) {
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }

  async verifyEmail({
    verificationToken,
  }: VerifyEmailInput): Promise<VerifyEmailOutput> {
    try {
      let userId;
      try {
        const temp = jwt.verify(
          verificationToken,
          this.configService.get<string>('VERIFY_TOKEN_SECRET'),
        ) as { userId: string };
        userId = temp.userId;
      } catch (err) {
        if (err instanceof jwt.JsonWebTokenError) {
          return createError('Verification token', 'Không hợp lệ!');
        }
      }
      const user = await this.userRepo.findOneBy({
        id: +userId,
      });
      const v = await this.verificationRepo.findOneBy({
        user: {
          id: +userId,
        },
        verificationType: VerificationType.EMAIL_VERIFICATION,
      });
      if (!user || !v)
        return createError('Verification token', 'Không hợp lệ!');
      await this.verificationRepo.remove(v);
      user.verified = true;
      await this.userRepo.save(user);
      return {
        ok: true,
      };
    } catch {
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }

  async verifyForgotPassword({
    verificationToken,
    password,
    confirmPassword,
  }: VerifyForgotPasswordInput): Promise<VerifyForgotPasswordOutput> {
    try {
      // check input
      let userId;
      try {
        const temp = jwt.verify(
          verificationToken,
          this.configService.get<string>('VERIFY_TOKEN_SECRET'),
        ) as { userId: string };
        userId = temp.userId;
      } catch (err) {
        if (err instanceof jwt.JsonWebTokenError) {
          return createError('Verification token', 'Không hợp lệ!');
        }
      }
      const user = await this.userRepo.findOneBy({
        id: +userId,
      });
      const v = await this.verificationRepo.findOneBy({
        user: {
          id: +userId,
        },
        verificationType: VerificationType.FORGOT_PASSWORD_VERIFICATION,
      });
      if (!user || !v)
        return createError('Verification token', 'Không hợp lệ!');
      if (password != confirmPassword)
        return createError('Password', 'Mật khẩu xác nhận không đúng');
      await this.verificationRepo.remove(v);
      user.password = password;
      await this.userRepo.save(user);
      return {
        ok: true,
      };
    } catch {
      return createError('Server', 'Lỗi server, thử lại sau');
    }
  }
}
