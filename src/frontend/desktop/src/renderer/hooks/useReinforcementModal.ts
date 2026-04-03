import { useCallback, useMemo, useState } from 'react';

export type ReinforcementModalProps = {
  isOpen: boolean;
  onClose: () => void;
  hasActiveContextPack: boolean;
  activeContextPackDir: string | null;
};

export type UseReinforcementModalResult = {
  reinforcementModalProps: ReinforcementModalProps;
  openReinforcementModal: () => void;
};

export function useReinforcementModal(
  hasActiveContextPack: boolean,
  activeContextPackDir: string | null,
): UseReinforcementModalResult {
  const [isOpen, setIsOpen] = useState(false);

  const openReinforcementModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const reinforcementModalProps = useMemo(
    () => ({ isOpen, onClose, hasActiveContextPack, activeContextPackDir }),
    [isOpen, onClose, hasActiveContextPack, activeContextPackDir],
  );

  return { reinforcementModalProps, openReinforcementModal };
}
