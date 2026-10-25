export const journeyStatuses = [
  "RUNNING",
  "CHECKIN_DUE",
  "GRACE_PERIOD",
  "ESCALATED",
  "SOS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type JourneyStatus = (typeof journeyStatuses)[number];

export const travelModes = ["cab/auto", "walking", "bus/metro"] as const;
