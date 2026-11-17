import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from '@shiplynow/shared';

// These classes only describe the API for the OpenAPI docs.
// Validation is done by the zod schemas in @shiplynow/shared.

export class LoginBody {
  @ApiProperty({ example: 'admin@shiplynow.local' })
  email: string;

  @ApiProperty({ example: 'change-me-please' })
  password: string;
}

export class PublicUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, example: '+201012345678' }) phone: string | null;
  @ApiProperty({ enum: ROLES }) role: Role;
}

export class AuthResponseDto {
  @ApiProperty({ type: PublicUserDto }) user: PublicUserDto;
  @ApiProperty({ description: 'Also set as an httpOnly cookie' }) accessToken: string;
  @ApiProperty({ description: 'Seconds until the access token expires' }) expiresIn: number;
}

export class MeResponseDto {
  @ApiProperty({ type: PublicUserDto }) user: PublicUserDto;
}
