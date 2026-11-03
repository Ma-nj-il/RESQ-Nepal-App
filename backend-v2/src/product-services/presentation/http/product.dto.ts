import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class PreferencesDto {
  @IsBoolean() bookingUpdates!: boolean;
  @IsBoolean() tripUpdates!: boolean;
  @IsBoolean() supportUpdates!: boolean;
  @IsBoolean() marketing!: boolean;
}

export class RatingDto {
  @IsInt() @Min(1) @Max(5) score!: number;
}

export class CashDto {
  @IsString() @Matches(/^(0|[1-9][0-9]{0,18})$/) amountMinor!: string;
}

export class MessageDto {
  @IsString() @MaxLength(4000) @Matches(/\S/u) message!: string;
}

export class TicketDto extends MessageDto {
  @IsIn(['SERVICE', 'BILLING', 'ACCOUNT', 'OTHER']) category!: string;
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsUUID() tripId?: string;
}

export class TicketTransitionDto {
  @IsIn(['START', 'RESOLVE']) action!: 'START' | 'RESOLVE';
  @ValidateIf(
    (object: TicketTransitionDto, value: unknown) =>
      object.action === 'RESOLVE' || value !== undefined,
  )
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/)
  resolutionCode?: string;
}

export class ProductPageDto {
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsUUID() afterId?: string;
}

export class CashSummaryDto {
  @IsISO8601({ strict: true }) @Matches(/T.*Z$/) from!: string;
  @IsISO8601({ strict: true }) @Matches(/T.*Z$/) to!: string;
}
