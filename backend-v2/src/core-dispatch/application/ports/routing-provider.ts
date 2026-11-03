export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RouteEstimate {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly source: string;
  readonly quality: 'PROVIDER_ROUTE' | 'DEVELOPMENT_ESTIMATE';
}

export interface RoutingProvider {
  estimate(origin: Coordinate, destination: Coordinate): Promise<RouteEstimate>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
