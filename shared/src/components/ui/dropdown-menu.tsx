import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type MutableRefObject,
} from 'react';

export * from '@radix-ui/react-dropdown-menu';

// Module state belongs to this renderer, so another window keeps its own menus.
let activeMenu: { id: symbol; close(): void } | undefined;
const Ownership = createContext<MutableRefObject<boolean> | null>(null);

export function Root({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Menu.DropdownMenuProps) {
  const [id] = useState(() => Symbol('dropdown'));
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const [dismissed, setDismissed] = useState(false);
  const replaced = useRef(false);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const requested = open ?? localOpen;

  const release = useCallback(() => {
    if (activeMenu?.id === id) activeMenu = undefined;
  }, [id]);
  const replace = useCallback(() => {
    replaced.current = true;
    setDismissed(true);
    setLocalOpen(false);
    change.current?.(false);
  }, []);
  const claim = useCallback(() => {
    const previous = activeMenu;
    activeMenu = { id, close: replace };
    replaced.current = false;
    setDismissed(false);
    if (previous?.id !== id) previous?.close();
  }, [id, replace]);
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) claim();
      else {
        release();
        setDismissed(true);
      }
      setLocalOpen(next);
      change.current?.(next);
    },
    [claim, release],
  );

  useLayoutEffect(() => {
    if (requested) claim();
    else release();
    return release;
  }, [requested, claim, release]);

  return (
    <Ownership.Provider value={replaced}>
      <Menu.Root {...props} open={requested && !dismissed} onOpenChange={setOpen} />
    </Ownership.Provider>
  );
}

export const Content = forwardRef<
  ComponentRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(function Content({ onCloseAutoFocus, ...props }, ref) {
  const replaced = useContext(Ownership);
  return (
    <Menu.Content
      {...props}
      ref={ref}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        // Closing the previous menu must not steal focus from the new menu.
        if (replaced?.current || activeMenu) event.preventDefault();
      }}
    />
  );
});

export { Root as DropdownMenu, Content as DropdownMenuContent };
