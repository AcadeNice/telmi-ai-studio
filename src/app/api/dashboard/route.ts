import { apiErrorResponse } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { getBudgetState } from "@/server/jobs/service";

export async function GET() {
  try {
    await requireSession();
    const budget = getBudgetState();
    return Response.json({
      monthlySpentCents: budget.monthlySpentCents,
      monthlyBudgetCents: budget.monthlyBudgetCents,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
