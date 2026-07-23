import { z } from 'zod'

const boundsSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])

const categorySchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
})

export const parcelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    name: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    epsg: z.literal(2274),
    recordCount: z.number().int().positive(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    attribution: z.string().min(1),
  }),
  projection: z.object({
    epsg: z.literal(3857),
    localOrigin: z.tuple([z.number().finite(), z.number().finite()]),
    bounds: boundsSchema,
    baseCellSizeMeters: z.number().positive(),
    minimumCellSizeMeters: z.number().positive(),
    gridOrigin: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  overviewUrl: z.string().min(1),
  shards: z.array(
    z.object({
      id: z.string().min(1),
      bounds: boundsSchema,
      featureCount: z.number().int().positive(),
      byteLength: z.number().int().positive(),
      url: z.string().endsWith('.fgb'),
    }),
  ),
  statistics: z.object({
    appraisalQuantiles: z.tuple([
      z.number(),
      z.number(),
      z.number(),
      z.number(),
    ]),
    landUse: z.array(categorySchema),
    zoning: z.array(categorySchema),
    featureTypes: z.array(categorySchema),
    missingAddress: z.number().int().nonnegative(),
    missingLandUse: z.number().int().nonnegative(),
    missingZoning: z.number().int().nonnegative(),
  }),
  validation: z.object({
    repairedRings: z.number().int().nonnegative(),
    sourceCoordinateCount: z.number().int().positive(),
    projectedCoordinateCount: z.number().int().positive(),
    simplifiedCoordinateCount: z.literal(0),
    shardRecordReferences: z.number().int().positive(),
    deduplicatedRecordCount: z.number().int().positive(),
    warnings: z.array(z.string()),
    generatedAt: z.string().datetime(),
  }),
})

export const mapSearchSchema = z.object({
  mode: z
    .enum(['overview', 'landUse', 'zoning', 'value'])
    .default('overview')
    .catch('overview'),
  parcel: z.string().optional(),
  parId: z.coerce.number().optional().catch(undefined),
  floor: z.string().optional(),
})

export const geocoderResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        address: z.string().catch('Nashville address'),
        score: z.number(),
        location: z
          .object({ x: z.number().finite(), y: z.number().finite() })
          .optional(),
        attributes: z.record(z.string(), z.string()).optional(),
      }),
    )
    .catch([]),
})

export const metroParcelResponseSchema = z.object({
  features: z
    .array(
      z.object({
        properties: z.record(z.string(), z.union([z.string(), z.number()])),
        geometry: z.object({
          type: z.string(),
          coordinates: z.unknown(),
        }),
      }),
    )
    .catch([]),
})
