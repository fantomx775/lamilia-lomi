export function scheduleReviewReminder(input: {
  unlockedAt: Date;
  delayDays?: number | null;
}) {
  const delayDays = input.delayDays && input.delayDays > 0 ? input.delayDays : 14;
  const scheduledFor = new Date(input.unlockedAt);

  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + delayDays);

  return scheduledFor;
}

export function shouldSendReminder(input: {
  scheduledFor: Date;
  status: "pending" | "sent" | "failed" | "cancelled";
  now?: Date;
}) {
  return (
    input.status === "pending" &&
    input.scheduledFor.getTime() <= (input.now ?? new Date()).getTime()
  );
}
