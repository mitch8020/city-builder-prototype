import { createFileRoute } from '@tanstack/react-router'
import {
  googleMapsErrorResponse,
  googleMapsGateway,
  parseGoogleTileCoordinates,
} from '../../../../../../map/google-maps.server'

export const Route = createFileRoute('/api/google-map/tiles/$zoom/$x/$y')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const coordinates = parseGoogleTileCoordinates(params)
          return await googleMapsGateway.tile(
            coordinates,
            request.headers.get('if-none-match'),
          )
        } catch (error) {
          return googleMapsErrorResponse(error)
        }
      },
    },
  },
})
