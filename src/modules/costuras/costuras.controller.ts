import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  CosturasService,
  type RelojRespuesta,
  type ResetRespuesta,
  type SeedRespuesta,
} from './costuras.service.js';

@Controller('__test__')
export class CosturasController {
  constructor(private readonly costurasService: CosturasService) {}

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async reset(): Promise<ResetRespuesta> {
    return this.costurasService.reset();
  }

  @Post('seed')
  @HttpCode(HttpStatus.CREATED)
  async seed(@Body() body: unknown): Promise<SeedRespuesta> {
    return this.costurasService.seed(body);
  }

  @Post('reloj')
  @HttpCode(HttpStatus.OK)
  reloj(@Body() body: unknown): RelojRespuesta {
    return this.costurasService.reloj(body);
  }
}
