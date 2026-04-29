import type { TablePlannerNode } from './types.js';
import type { EdmReport } from './edm.js';

export function tableEdmPerUnit(tableNode: TablePlannerNode, report: EdmReport): number | null {
  const primaryOutputPerCycle = tableNode.variant.Products.find(p => p.Name === tableNode.itemName)?.Ammount ?? 1;
  const outputAmount = primaryOutputPerCycle * tableNode.cycles;
  const totalEdm = report.tableEdm.get(tableNode.id) ?? null;
  return totalEdm !== null && outputAmount > 0 ? totalEdm / outputAmount : null;
}

