import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Данные формы «Оставить заявку». Те же правила, что и на клиенте (frontend: src/lib/lead.ts). */
export class CreateLeadDto {
  @ApiProperty({ example: 'Иван Петров', description: 'Имя или название организации' })
  @Transform(trim)
  @IsString({ message: 'Укажите, как к вам обращаться' })
  @Length(2, 200, { message: 'Укажите, как к вам обращаться' })
  name!: string;

  @ApiProperty({ example: '+7 900 000-00-00' })
  @Transform(trim)
  @IsString({ message: 'Укажите телефон' })
  @Matches(/^\+?[\d\s()-]{10,20}$/, { message: 'Укажите номер полностью: +7 XXX XXX-XX-XX' })
  @Transform(({ value }: { value: string }) => value, { toClassOnly: true })
  phone!: string;

  @ApiPropertyOptional({ example: 'name@company.ru' })
  @Transform(trim)
  @IsOptional()
  @IsEmail({}, { message: 'Укажите корректный адрес почты' })
  @MaxLength(200)
  email?: string;

  @ApiProperty({ example: 'Нужно изготовить корпус по чертежу, 10 шт.' })
  @Transform(trim)
  @IsString({ message: 'Опишите задачу — хотя бы в двух словах' })
  @Length(10, 5000, { message: 'Опишите задачу — хотя бы в двух словах' })
  task!: string;

  @ApiPropertyOptional({ description: 'Токен Yandex SmartCaptcha' })
  @IsOptional()
  @IsString()
  captchaToken?: string;

  @ApiPropertyOptional({ description: 'Страница, с которой отправлена заявка' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  page?: string;

  @ApiPropertyOptional({ description: 'Поле-ловушка: у людей всегда пустое' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;
}
