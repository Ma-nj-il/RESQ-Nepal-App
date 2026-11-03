import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const SIMPLE_CODE = /^[A-Z][A-Z0-9_]{1,95}$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,18})$/;

export class CoverageCheckDto {
  @IsString()
  @Matches(SIMPLE_CODE)
  readonly serviceCategory!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  readonly pickupLatitude!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  readonly pickupLongitude!: number;
}

export class FareQuoteCreationDto extends CoverageCheckDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  readonly destinationLatitude!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  readonly destinationLongitude!: number;
}

export class BookingCreationDto extends FareQuoteCreationDto {
  @IsUUID('all')
  readonly fareQuoteId!: string;

  @IsUUID('all')
  readonly pickupGeographicUnitId!: string;

  @IsOptional()
  @IsUUID('all')
  readonly destinationGeographicUnitId?: string;

  @IsEnum(['ROUTINE', 'URGENT', 'EMERGENCY'])
  readonly urgency!: 'ROUTINE' | 'URGENT' | 'EMERGENCY';

  @IsString()
  @Length(2, 160)
  readonly patientName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  readonly patientPhone?: string;

  @IsString()
  @Length(2, 160)
  readonly pickupContactName!: string;

  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/)
  readonly pickupContactPhone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  readonly assistanceNotes?: string;

  @IsBoolean()
  readonly emergencyTransportConsent!: boolean;

  @IsBoolean()
  readonly locationSharingConsent!: boolean;
}

export class ReasonCommandDto {
  @IsString()
  @Matches(SIMPLE_CODE)
  readonly reasonCode!: string;

  @IsString()
  @Length(3, 1024)
  readonly reason!: string;
}

export class OfferAcceptanceDto {
  @IsUUID('all')
  readonly driverId!: string;

  @IsUUID('all')
  readonly ambulanceId!: string;
}

export class TripTransitionDto {
  @IsString()
  @Matches(SIMPLE_CODE)
  readonly reasonCode!: string;

  @IsOptional()
  @IsString()
  @Length(3, 1024)
  readonly reason?: string;

  @IsOptional()
  @IsString()
  @Matches(UNSIGNED_INTEGER)
  readonly pickupOdometerMeters?: string;
}

export class TripCompletionDto extends TripTransitionDto {
  @IsOptional()
  @IsString()
  @Matches(UNSIGNED_INTEGER)
  readonly completionOdometerMeters?: string;

  @IsString()
  @Matches(UNSIGNED_INTEGER)
  readonly distanceMeters!: string;

  @IsString()
  @Matches(UNSIGNED_INTEGER)
  readonly finalFareMinor!: string;

  @IsString()
  @Matches(/^NPR$/)
  readonly finalFareCurrency!: 'NPR';

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly finalFareProvenance!: string;
}

export class TripCancellationDto extends ReasonCommandDto {
  @IsInt()
  @Min(1)
  readonly expectedBookingVersion!: number;
}

export class LocationPointDto {
  @IsUUID('all')
  readonly pointId!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  readonly sequence!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  readonly latitude!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  readonly longitude!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(500)
  readonly accuracyMeters!: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(360)
  readonly headingDegrees?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  readonly speedMetersPerSecond?: number;

  @IsEnum(['GOOD', 'REDUCED', 'POOR'])
  readonly quality!: 'GOOD' | 'REDUCED' | 'POOR';

  @IsISO8601({ strict: true })
  readonly capturedAt!: string;
}

export class LocationPointBatchDto {
  @IsUUID('all')
  readonly sourceDeviceId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  readonly points!: readonly LocationPointDto[];
}

export class SafetyIncidentCreationDto {
  @IsOptional()
  @IsUUID('all')
  readonly tripId?: string;

  @IsEnum(['SOS', 'SAFETY_CONCERN', 'ROUTE_DEVIATION'])
  readonly incidentType!: 'SOS' | 'SAFETY_CONCERN' | 'ROUTE_DEVIATION';

  @IsEnum(['CRITICAL', 'HIGH', 'MEDIUM'])
  readonly severity!: 'CRITICAL' | 'HIGH' | 'MEDIUM';

  @IsString()
  @Length(3, 2048)
  readonly details!: string;
}

export class SafetyIncidentTransitionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  readonly targetTier?: number;

  @IsString()
  @Matches(SIMPLE_CODE)
  readonly outcomeCode!: string;

  @IsOptional()
  @IsString()
  @Length(3, 1024)
  readonly reason?: string;
}
