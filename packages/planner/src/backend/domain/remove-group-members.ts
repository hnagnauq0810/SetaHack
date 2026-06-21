// rbac: delegates — forwards to removeGroupMember, which enforces the planner.group.member.write permission per user.
import type { PlannerSessionScope } from './_actor.ts';
import { removeGroupMember } from './remove-group-member.ts';

export async function removeGroupMembers(input: {
  group_id: string;
  user_ids: string[];
  session: PlannerSessionScope;
}): Promise<void> {
  for (const user_id of input.user_ids) {
    await removeGroupMember({ group_id: input.group_id, user_id, session: input.session });
  }
}
