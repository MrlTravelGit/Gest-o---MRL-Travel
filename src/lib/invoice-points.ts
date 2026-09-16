export type InvoiceEarningType = "usd" | "brl" | "fixed" | "custom";

export interface InvoiceCardRule {
  cardName: string;
  earningType: InvoiceEarningType;
  pointsPerUsd?: number | null;
  pointsPerBrl?: number | null;
}

export interface CalculateInvoicePointsInput {
  invoiceTotal: number;
  domesticAmount?: number | null;
  internationalAmount?: number | null;
  exchangeRate?: number | null;
  cardRule?: InvoiceCardRule | null;
  programName?: string | null;
  programMileValue?: number | null;
  actualReceivedPoints?: number | null;
}

export interface InvoiceCalculationSnapshot {
  card_name: string;
  earning_type: InvoiceEarningType;
  points_per_usd: number | null;
  points_per_brl: number | null;
  invoice_total: number;
  exchange_rate: number | null;
  converted_usd: number | null;
  estimated_points: number | null;
  program_name: string | null;
  mile_value: number | null;
  estimated_points_value: number | null;
}

export interface InvoicePointsResult {
  convertedUsd: number | null;
  estimatedPoints: number | null;
  estimatedPointsValue: number | null;
  pointsDifference: number | null;
  calculationSnapshot: InvoiceCalculationSnapshot | null;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateInvoicePoints(input: CalculateInvoicePointsInput): InvoicePointsResult {
  const total = Number(input.invoiceTotal);
  const rule = input.cardRule;
  if (!rule || !Number.isFinite(total) || total < 0) {
    return { convertedUsd: null, estimatedPoints: null, estimatedPointsValue: null, pointsDifference: null, calculationSnapshot: null };
  }

  const exchangeRate = input.exchangeRate == null ? null : Number(input.exchangeRate);
  let convertedUsd: number | null = null;
  let rawPoints: number | null = null;

  if (rule.earningType === "usd") {
    const rate = Number(rule.pointsPerUsd);
    if (exchangeRate != null && exchangeRate > 0 && Number.isFinite(rate) && rate > 0) {
      convertedUsd = round2(total / exchangeRate);
      rawPoints = (total / exchangeRate) * rate;
    }
  } else {
    const rate = Number(rule.pointsPerBrl);
    if (Number.isFinite(rate) && rate > 0) rawPoints = total * rate;
  }

  const estimatedPoints = rawPoints == null ? null : Math.round(rawPoints);
  const mileValue = input.programMileValue == null ? null : Number(input.programMileValue);
  const estimatedPointsValue = estimatedPoints == null || mileValue == null || !Number.isFinite(mileValue)
    ? null
    : round2((estimatedPoints / 1000) * mileValue);
  const actual = input.actualReceivedPoints == null ? null : Number(input.actualReceivedPoints);
  const pointsDifference = estimatedPoints == null || actual == null || !Number.isFinite(actual)
    ? null
    : Math.round(actual - estimatedPoints);

  return {
    convertedUsd,
    estimatedPoints,
    estimatedPointsValue,
    pointsDifference,
    calculationSnapshot: {
      card_name: rule.cardName,
      earning_type: rule.earningType,
      points_per_usd: rule.pointsPerUsd ?? null,
      points_per_brl: rule.pointsPerBrl ?? null,
      invoice_total: round2(total),
      exchange_rate: exchangeRate,
      converted_usd: convertedUsd,
      estimated_points: estimatedPoints,
      program_name: input.programName ?? null,
      mile_value: mileValue,
      estimated_points_value: estimatedPointsValue,
    },
  };
}
