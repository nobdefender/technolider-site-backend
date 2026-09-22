import { Body, Controller, Get, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsService, type UploadedLeadFile } from './leads.service';

@ApiTags('Заявки')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Отправить заявку с формы сайта' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateLeadDto })
  @ApiResponse({ status: 201, description: 'Заявка принята' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации, капчи или доставки' })
  @UseInterceptors(FilesInterceptor('files'))
  async create(
    @Body() dto: CreateLeadDto,
    @UploadedFiles() files: UploadedLeadFile[] | undefined,
    @Req() req: Request,
  ) {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    return this.leads.create(dto, files || [], {
      ip: forwarded || req.ip,
      userAgent: req.headers['user-agent'],
      referer: req.headers.referer,
    });
  }

  /** Служебное: список заявок. Только по админ-ключу (X-Admin-Key). */
  @Get()
  @ApiExcludeEndpoint()
  @UseGuards(AdminGuard)
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.leads.list(limit ? +limit : undefined, offset ? +offset : undefined);
  }
}
