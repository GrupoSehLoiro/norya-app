/**
 * BrandCatalogController — busca no catálogo global de marcas (onboarding).
 * Apenas leitura; qualquer usuário autenticado pode buscar.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { BrandCatalogItem, BrandCatalogService } from './brand-catalog.service';

@Controller('v2/brand-catalog')
export class BrandCatalogController {
  constructor(private readonly catalog: BrandCatalogService) {}

  @Get()
  search(@Query('q') q?: string, @Query('limit') limit?: string): Promise<BrandCatalogItem[]> {
    const lim = limit ? Number(limit) : 12;
    return this.catalog.search(q ?? '', Number.isFinite(lim) ? lim : 12);
  }
}
