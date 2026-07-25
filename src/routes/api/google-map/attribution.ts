import { createFileRoute } from '@tanstack/react-router'
import {
  googleMapsErrorResponse,
  googleMapsGateway,
  parseGoogleViewport,
} from '../../../map/google-maps.server'

export const Route = createFileRoute('/api/google-map/attribution')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await googleMapsGateway.attribution(
            parseGoogleViewport(request.url),
          )
        } catch (error) {
          return googleMapsErrorResponse(error)
        }
      },
    },
  },
})
