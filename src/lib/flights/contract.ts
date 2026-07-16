export type FlightCategory = 'commercial' | 'private' | 'jet' | 'military';

export interface Flight {
  callsign: string;
  lat: number;
  lng: number;
  alt: number;
  heading: number;
  speed_knots: number | null;
  model: string;
  icao24: string;
  registration: string;
  squawk: string;
  airline_code: string;
  aircraft_category: 'heli' | 'plane';
  category: FlightCategory;
  grounded: boolean;
  nac_p?: number | null;
  type: 'flight';
}

export interface GpsJammingCell {
  lat: number;
  lng: number;
  severity: number;
  count: number;
}

export interface FlightResponse {
  commercial_flights: Flight[];
  private_flights: Flight[];
  private_jets: Flight[];
  military_flights: Flight[];
  gps_jamming: GpsJammingCell[];
  total: number;
  source: string;
  timestamp: string;
}

export function buildFlightResponse(
  flights: Flight[],
  gpsJamming: GpsJammingCell[],
  source: string,
  generatedAt: Date,
): FlightResponse {
  const commercial_flights: Flight[] = [];
  const private_flights: Flight[] = [];
  const private_jets: Flight[] = [];
  const military_flights: Flight[] = [];

  for (const flight of flights) {
    switch (flight.category) {
      case 'military':
        military_flights.push(flight);
        break;
      case 'jet':
        private_jets.push(flight);
        break;
      case 'private':
        private_flights.push(flight);
        break;
      default:
        commercial_flights.push(flight);
        break;
    }
  }

  return {
    commercial_flights,
    private_flights,
    private_jets,
    military_flights,
    gps_jamming: gpsJamming,
    total: flights.length,
    source,
    timestamp: generatedAt.toISOString(),
  };
}
