// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentOwnerFinancePeriodKey,
  formatOwnerFinancePeriodLabel,
  type OwnerFinanceWorkspace,
  type OwnerWithdrawal,
} from '@/lib/OwnerFinanceService';

const exportMocks = vi.hoisted(() => ({
  pdf: vi.fn(),
  excel: vi.fn(),
  csv: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  fetchWorkspace: vi.fn(),
  saveSettings: vi.fn(),
  createWithdrawal: vi.fn(),
  cancelWithdrawal: vi.fn(),
  createConcept: vi.fn(),
  updateConcept: vi.fn(),
}));

vi.mock('@/services/OwnerFinanceRepositoryService', () => ({
  OwnerFinanceRepositoryService: serviceMocks,
}));

vi.mock('@/lib/OwnerFinanceExports', () => ({
  exportOwnerFinancePdf: exportMocks.pdf,
  exportOwnerFinanceExcel: exportMocks.excel,
  exportOwnerFinanceCsv: exportMocks.csv,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'owner-user-ui',
      username: 'owner-ui',
      displayName: 'Propietario UI',
      role: 'master',
      permissions: ['manage_finances'],
    },
  }),
}));

import OwnerFinances from '@/pages/OwnerFinances';

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function moveMonth(periodKey: string, offset: number): string {
  const [year, month] = periodKey.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const currentPeriod = currentOwnerFinancePeriodKey();
const previousPeriod = moveMonth(currentPeriod, -1);
const futurePeriod = moveMonth(currentPeriod, 1);

function workspaceFor(
  periodKey: string,
  values: Partial<OwnerFinanceWorkspace['dashboard']> = {},
  status: 'OPEN' | 'CLOSED' = 'OPEN',
): OwnerFinanceWorkspace {
  return {
    selectedPeriod: periodKey,
    periods: [currentPeriod, previousPeriod, futurePeriod]
      .sort((left, right) => right.localeCompare(left))
      .map(key => ({
        key,
        label: formatOwnerFinancePeriodLabel(key),
        status: key === periodKey ? status : 'OPEN',
        hasFinancialData: true,
      })),
    dashboard: {
      monthlyProfitGoal: 10_000_000,
      profitMonth: 6_000_000,
      availableProfit: 6_000_000,
      withdrawnProfit: 1_000_000,
      availableBalance: 5_000_000,
      projectedWithdrawalPercentage: 30,
      suggestedWithdrawalValue: 1_500_000,
      monthlyGoalProgressPercentage: 60,
      monthlyGoalProgressBarPercentage: 60,
      monthlyGoalReachedValue: 6_000_000,
      monthlyGoalRemainingValue: 4_000_000,
      monthlyGoalReached: false,
      exceedsAvailable: false,
      ...values,
    },
    withdrawals: [],
    concepts: [{
      id: 'concept-1',
      name: 'Retiro del propietario',
      nameKey: 'retiro del propietario',
      active: true,
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    settings: {
      projectedWithdrawalPercentage: 30,
      monthlyProfitGoal: 10_000_000,
      financialPeriod: 'MONTHLY',
      periodKey,
      periodStatus: status,
      closedAt: status === 'CLOSED' ? '2026-07-20T15:30:00.000Z' : null,
      closedBy: status === 'CLOSED' ? 'Propietario UI' : null,
      reopenedAt: null,
      reopenedBy: null,
    },
    accounts: [{ id: 'account-1', name: 'Caja Principal', balance: 20_000_000 }],
    users: [{ id: 'owner-user-ui', displayName: 'Propietario UI' }],
    paymentMethods: ['EFECTIVO'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.saveSettings.mockResolvedValue(undefined);
  serviceMocks.createWithdrawal.mockResolvedValue(undefined);
  serviceMocks.cancelWithdrawal.mockResolvedValue(undefined);
  serviceMocks.createConcept.mockResolvedValue(undefined);
  serviceMocks.updateConcept.mockResolvedValue(undefined);
  serviceMocks.fetchWorkspace.mockImplementation(({ periodKey }: { periodKey?: string }) => (
    Promise.resolve(workspaceFor(periodKey || currentPeriod))
  ));
});

describe('Finanzas del Propietario V2 - experiencia por períodos', () => {
  it('muestra claramente período, estado y el resumen ejecutivo solicitado', async () => {
    render(<OwnerFinances />);

    expect(await screen.findByTestId('owner-finance-selected-period'))
      .toHaveTextContent(formatOwnerFinancePeriodLabel(currentPeriod));
    expect(screen.getByTestId('owner-finance-period-status')).toHaveTextContent('Abierto');

    const summary = screen.getByRole('region', { name: 'Resumen ejecutivo del período' });
    for (const label of [
      'Utilidad generada',
      'Utilidad retirada',
      'Saldo disponible',
      'Meta mensual',
      'Cumplimiento',
      'Valor restante para alcanzar la meta',
    ]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(within(summary).getByText(currency.format(6_000_000))).toBeInTheDocument();
    expect(within(summary).getByText('60.00 %')).toBeInTheDocument();
  });

  it('muestra la auditoría de cierre dentro de la configuración del período', async () => {
    serviceMocks.fetchWorkspace.mockResolvedValue(workspaceFor(currentPeriod, {}, 'CLOSED'));
    render(<OwnerFinances />);

    expect(await screen.findByTestId('owner-finance-period-status')).toHaveTextContent('Cerrado');
    const audit = screen.getByLabelText('Auditoría del período');
    expect(audit).toHaveTextContent('Último cierre:');
    expect(audit).toHaveTextContent('Propietario UI');
  });

  it('cambia inmediatamente la cabecera y luego carga el Dashboard del nuevo período', async () => {
    let resolvePrevious: (workspace: OwnerFinanceWorkspace) => void = () => undefined;
    const previousPromise = new Promise<OwnerFinanceWorkspace>((resolve) => {
      resolvePrevious = resolve;
    });
    serviceMocks.fetchWorkspace.mockImplementation(({ periodKey }: { periodKey?: string }) => {
      if (periodKey === previousPeriod) return previousPromise;
      return Promise.resolve(workspaceFor(currentPeriod));
    });

    render(<OwnerFinances />);
    await screen.findAllByText(currency.format(6_000_000));

    fireEvent.change(screen.getByLabelText('Período financiero'), {
      target: { value: previousPeriod },
    });

    expect(screen.getByTestId('owner-finance-selected-period'))
      .toHaveTextContent(formatOwnerFinancePeriodLabel(previousPeriod));
    expect(screen.queryAllByText(currency.format(6_000_000))).toHaveLength(0);

    resolvePrevious(workspaceFor(previousPeriod, {
      profitMonth: 3_000_000,
      monthlyGoalReachedValue: 3_000_000,
      monthlyGoalRemainingValue: 7_000_000,
      monthlyGoalProgressPercentage: 30,
      monthlyGoalProgressBarPercentage: 30,
    }));

    await waitFor(() => {
      const summary = screen.getByRole('region', { name: 'Resumen ejecutivo del período' });
      expect(within(summary).getByText(currency.format(3_000_000))).toBeInTheDocument();
      expect(within(summary).getByText('30.00 %')).toBeInTheDocument();
    });
  });

  it('solicita la advertencia completa mediante un diálogo React antes de cerrar el período', async () => {
    render(<OwnerFinances />);
    await screen.findByTestId('owner-finance-selected-period');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar período' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`¿Desea cerrar el período ${formatOwnerFinancePeriodLabel(currentPeriod)}?`))
      .toBeInTheDocument();
    expect(within(dialog).getByText('No será posible registrar nuevos retiros.')).toBeInTheDocument();
    expect(within(dialog).getByText('No será posible anular retiros.')).toBeInTheDocument();
    expect(within(dialog).getByText('La información continuará disponible para consulta y exportación.'))
      .toBeInTheDocument();
    expect(within(dialog).getByText('Solo podrá modificarse nuevamente si el período es reabierto.'))
      .toBeInTheDocument();
    expect(serviceMocks.saveSettings).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }));

    await waitFor(() => expect(serviceMocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      periodKey: currentPeriod,
      periodStatus: 'CLOSED',
    })));
  });

  it('anula un retiro únicamente después de confirmar el diálogo y recarga Dashboard, historial y reportes', async () => {
    const activeWithdrawal: OwnerWithdrawal = {
      id: 'withdrawal-1',
      withdrawalDate: `${currentPeriod}-10T14:30:00`,
      periodKey: currentPeriod,
      userId: 'owner-user-ui',
      userName: 'Propietario UI',
      conceptId: 'concept-1',
      conceptName: 'Retiro del propietario',
      amount: 1_000_000,
      observations: '',
      accountId: 'account-1',
      accountName: 'Caja Principal',
      paymentMethod: 'EFECTIVO',
      status: 'ACTIVE',
      financialMovementId: 'movement-1',
      createdAt: `${currentPeriod}-10T14:30:00`,
    };
    const beforeCancellation = workspaceFor(currentPeriod);
    beforeCancellation.withdrawals = [activeWithdrawal];
    const afterCancellation = workspaceFor(currentPeriod, {
      withdrawnProfit: 0,
      availableBalance: 6_000_000,
      suggestedWithdrawalValue: 1_800_000,
    });
    afterCancellation.withdrawals = [{
      ...activeWithdrawal,
      status: 'ANULADO',
      cancellationReason: 'Registro duplicado',
      cancelledAt: `${currentPeriod}-11T09:00:00`,
      cancelledBy: 'Propietario UI',
      reversalMovementId: 'reversal-1',
    }];
    serviceMocks.fetchWorkspace
      .mockResolvedValueOnce(beforeCancellation)
      .mockResolvedValueOnce(afterCancellation);

    render(<OwnerFinances />);
    const cancelButton = await screen.findByRole('button', { name: 'Anular retiro' });

    fireEvent.click(cancelButton);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Anular retiro' })).toBeInTheDocument();
    expect(serviceMocks.cancelWithdrawal).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Motivo de anulación'), {
      target: { value: 'Registro duplicado' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar anulación' }));

    await waitFor(() => expect(serviceMocks.cancelWithdrawal).toHaveBeenCalledWith(
      'withdrawal-1',
      'Registro duplicado',
    ));
    await waitFor(() => expect(screen.getByText('Anulado')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Anular retiro' })).not.toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Resumen ejecutivo del período' });
    const balanceCard = within(summary).getByText('Saldo disponible').closest('article');
    expect(balanceCard).not.toBeNull();
    expect(within(balanceCard as HTMLElement).getByText(currency.format(6_000_000))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    for (const exportReport of [exportMocks.pdf, exportMocks.excel, exportMocks.csv]) {
      expect(exportReport).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'withdrawal-1', status: 'ANULADO' })]),
        expect.objectContaining({ withdrawnProfit: 0, availableBalance: 6_000_000 }),
        expect.objectContaining({ key: currentPeriod }),
        expect.objectContaining({ generatedBy: 'Propietario UI' }),
      );
    }
  });

  it('bloquea el cierre futuro y explica el motivo sin llamar al servicio', async () => {
    render(<OwnerFinances />);
    await screen.findByTestId('owner-finance-selected-period');

    fireEvent.change(screen.getByLabelText('Período financiero'), {
      target: { value: futurePeriod },
    });
    await waitFor(() => {
      expect(screen.getByTestId('owner-finance-selected-period'))
        .toHaveTextContent(formatOwnerFinancePeriodLabel(futurePeriod));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar período' }));

    expect(await screen.findByText('No es posible cerrar un período futuro. Espere a que el mes haya comenzado.'))
      .toBeInTheDocument();
    expect(serviceMocks.saveSettings).not.toHaveBeenCalled();
  });
});
