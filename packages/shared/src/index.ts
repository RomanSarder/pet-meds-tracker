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
