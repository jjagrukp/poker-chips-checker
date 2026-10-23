import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/app/testing/render-app';
import type { PhotoAnalysis } from '@/features/chip-inventory/photo/schema';
import type { AnalyseResult, PhotoService } from '@/features/chip-inventory/photo/service';

// Spec 06 §6 client tests: the flag hides the route, proposals land as unconfirmed rows, and
// every failure offers manual entry. Rendered inside the real wizard (ChipsStep).

const ANALYSIS: PhotoAnalysis = {
  schemaVersion: 1,
  status: 'ok',
  chipTypes: [
    {
      proposalId: 'c1',
      primaryColour: 'red',
      secondaryColours: [],
      pattern: null,
      printedValue: null,
      estimatedCount: 50,
      countConfidence: 'high',
      notes: null,
    },
    {
      proposalId: 'c2',
      primaryColour: 'green',
      secondaryColours: [],
      pattern: null,
      printedValue: 25,
      estimatedCount: 12,
      countConfidence: 'low',
      notes: null,
    },
  ],
  imageIssues: [],
  message: null,
};

function fakePhoto(enabled: boolean, result: AnalyseResult = { ok: true, analysis: ANALYSIS }) {
  const analyse = vi.fn<PhotoService['analyse']>(async () => result);
  const service: PhotoService = {
    config: async () => ({ aiPhotoEnabled: enabled }),
    prepare: async () => ({ ok: true, bytes: new Uint8Array([0xff, 0xd8]), width: 10, height: 10 }),
    analyse,
  };
  return { service, analyse };
}

async function openChips(photo?: PhotoService) {
  await renderApp('/', undefined, photo ? { photo } : {});
  fireEvent.click(await screen.findByRole('button', { name: 'New tournament' }));
  await screen.findByRole('heading', { level: 1, name: 'Basics' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { level: 1, name: 'Length' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { level: 1, name: 'Chips' });
}

const panel = () => within(screen.getByRole('region', { name: 'Start from a photo' }));

function pickPhoto() {
  const input = screen.getByLabelText('Take or choose a photo');
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'chips.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('photo route', () => {
  it('is hidden when the feature is off or there is no service', async () => {
    await openChips(fakePhoto(false).service);
    await waitFor(() => expect(screen.queryByText('Start from a photo')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add chip type' })).toBeInTheDocument();
  });

  it('turns proposals into unconfirmed rows that block confirming', async () => {
    const { service, analyse } = fakePhoto(true);
    await openChips(service);
    expect(await screen.findByText(/isn't stored/)).toBeInTheDocument();
    pickPhoto();

    await screen.findByText(/Found 2 chip types/);
    expect(analyse).toHaveBeenCalledTimes(1);
    const red = screen.getByRole('listitem', { name: 'Chip type: Red' });
    expect(within(red).getByLabelText('How many')).toHaveValue('50');
    expect(within(red).getByText(/Count these to check/)).toBeInTheDocument();
    // Low confidence: no count prefilled; the printed value carries over.
    const green = screen.getByRole('listitem', { name: 'Chip type: Green' });
    expect(within(green).getByLabelText('How many')).toHaveValue('');
    expect(within(green).getByLabelText('Value in this tournament')).toHaveValue('25');

    expect(screen.getByRole('button', { name: 'Confirm inventory' })).toBeDisabled();
    fireEvent.click(within(red).getByRole('button', { name: 'Red looks right' }));
    expect(within(red).queryByText(/Count these to check/)).not.toBeInTheDocument();
  });

  it('says when the photo is not chips and offers manual entry', async () => {
    await openChips(
      fakePhoto(true, { ok: true, analysis: { ...ANALYSIS, status: 'not_chips', chipTypes: [] } })
        .service,
    );
    await screen.findByText('Start from a photo');
    pickPhoto();
    expect(await panel().findByRole('alert')).toHaveTextContent("That doesn't look like chips.");
    fireEvent.click(screen.getByRole('button', { name: 'Enter manually' }));
    expect(panel().queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows retake tips for unclear photos', async () => {
    const unclear = { ...ANALYSIS, status: 'unclear' as const, imageIssues: ['glare' as const] };
    await openChips(fakePhoto(true, { ok: true, analysis: unclear }).service);
    await screen.findByText('Start from a photo');
    pickPhoto();
    expect(await screen.findByText(/There is glare/)).toBeInTheDocument();
    expect(screen.getByText(/check these closely/)).toBeInTheDocument();
  });

  it('falls back to manual entry on failures', async () => {
    await openChips(fakePhoto(true, { ok: false, reason: 'daily_cap' }).service);
    await screen.findByText('Start from a photo');
    pickPhoto();
    expect(await panel().findByRole('alert')).toHaveTextContent('Enter your chips manually');
    expect(screen.getByRole('button', { name: 'Enter manually' })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: /Chip type: Red/ })).not.toBeInTheDocument();
  });

  it('can be cancelled while analysing', async () => {
    const { service, analyse } = fakePhoto(true);
    analyse.mockImplementation(
      (_blob, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    await openChips(service);
    await screen.findByText('Start from a photo');
    pickPhoto();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(await screen.findByLabelText('Take or choose a photo')).toHaveFocus();
    expect(panel().queryByRole('alert')).not.toBeInTheDocument();
  });
});
