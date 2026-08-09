export interface SessionUser {
  id: string;
  email: string;
}

export type {
  HouseholdDto,
  MemberDto,
  SelfDto,
  JoinCodeDto,
  JoinPreviewDto,
  JoinPreviewPetDto,
  JoinCodeRejection,
  JoinCodeVerdict,
  HouseholdStateDto,
  IssueJoinCodeBody,
  RedeemJoinCodeBody,
  SetDisplayNameBody,
  CreateHouseholdBody,
  LeaveHouseholdBody,
  LeaveHouseholdResult,
  ConfirmationRequiredError,
  JoinCodeRejectedError,
} from "./household";

export type {
  IsoDateTime,
  LocalDate,
  LocalTime,
  IsoWeekday,
  Tint,
  SpeciesDto,
  MedicationFormDto,
  CourseStatusDto,
  DoseEventStatusDto,
  StockReasonDto,
  CourseEventKindDto,
  ScheduleDto,
  CourseSnapshotDto,
  PetDto,
  MedicationDto,
  CourseDto,
  DoseEventDto,
  StockAdjustmentDto,
  CourseEventDto,
  SyncPayload,
  SyncPushBody,
  SyncPushResult,
  SyncPullResult,
} from "./sync";
