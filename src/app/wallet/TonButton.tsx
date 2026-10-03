'use client';

import { TonConnectUIProvider, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { useEffect, useRef } from 'react';
import type { Signed } from './page';

interface Props {
  nonce: string;
  busy: boolean;
  onProof: (signed: Signed) => void;
  onError: (message: string) => void;
}

function Inner({ nonce, busy, onProof, onError }: Props) {
  const [ui] = useTonConnectUI();
  const wallet = useTonWallet();
  const sent = useRef(false);

  useEffect(() => {
    // The wallet signs the request's nonce in its proof while connecting.
    ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: nonce } });
  }, [ui, nonce]);

  useEffect(() => {
    if (!wallet || sent.current) {
      return;
    }
    const item = wallet.connectItems?.tonProof;
    if (item && 'proof' in item) {
      sent.current = true;
      onProof({ chain: 'ton', address: wallet.account.address, proof: item.proof });
    } else if (item && 'error' in item) {
      onError('The TON wallet didn\'t sign: try again');
    }
  }, [wallet, onProof, onError]);

  async function connect() {
    try {
      if (ui.connected) {
        await ui.disconnect();
      }
      sent.current = false;
      await ui.openModal();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <button className="button wide" disabled={busy} onClick={connect}>
      TON wallet (Tonkeeper, MyTonWallet…)
    </button>
  );
}

export default function TonButton(props: Props) {
  return (
    <TonConnectUIProvider manifestUrl={`${window.location.origin}/tonconnect-manifest.json`}>
      <Inner {...props} />
    </TonConnectUIProvider>
  );
}
