import { PortfolioSnapshot, RebalancePlan } from '@repo/shared';

export async function generateExplanation(
  snapshot: PortfolioSnapshot,
  plan: RebalancePlan,
  apiKey?: string
): Promise<string> {
  const cents = (BigInt(snapshot.totalValueUsd) + 500000n) / 1000000n;
  const displayUsd = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  const fallbackText = `[Hệ thống] ${plan.ruleReasoning} Tổng giá trị danh mục hiện tại: $${displayUsd}. Số bước dự kiến: ${plan.steps.length}.`;

  if (!apiKey || plan.status === 'NO_ACTION') {
    return fallbackText;
  }

  try {
    const prompt = `Bạn là trợ lý phân tích quỹ tài chính. Hãy giải thích ngắn gọn (tối đa 3 câu tiếng Việt) kế hoạch tái cân bằng sau đây dựa trên dữ liệu thực tế, không tự bịa số liệu:
    - Trạng thái: ${plan.status}
    - Tái cân bằng một phần theo giới hạn hiện tại: ${plan.isPartial}
    - Số bước lệnh: ${plan.steps.length}
    - Lý do hệ thống: ${plan.ruleReasoning}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });

    if (!response.ok) return fallbackText;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || fallbackText;
  } catch {
    return fallbackText;
  }
}
