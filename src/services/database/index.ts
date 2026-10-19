export { supabase, isSupabaseConfigured } from './client';
export { profilesService } from './profiles';
export { driversService } from './drivers';
export { ambulancesService } from './ambulances';
export { bookingsService } from './bookings';
export { assignedCrewService } from './assignedCrew';
export { tripsService } from './trips';
export { ratingsService } from './ratings';
export { notificationsService } from './notifications';
export { savedPlacesService } from './savedPlaces';
export { hospitalsService } from './hospitals';
export { supportRequestsService } from './supportRequests';
export {
  identityDocumentsService,
  identityApplicationsService,
  loadIdentityStatus,
  IdentityServiceError,
} from './identity';
export type { IdentityStatusBundle } from './identity';
