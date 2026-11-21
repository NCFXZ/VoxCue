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
import { animateDropdownEnter, animateDropdownExit } from './dropdown-motion';
import { ChevronDown } from '../icons';

export * from '@radix-ui/react-dropdown-menu';

export function TriggerChevron() {
  return <ChevronDown size={14} />;
}

// Module state belongs to this renderer, so another window keeps its own menus.
let activeMenu: { id: symbol; close(): void } | undefined;
const MenuState = createContext<{
  open: boolean;
  openNow: MutableRefObject<boolean>;
  mounted: MutableRefObject<boolean>;
  replaced: MutableRefObject<boolean>;
  exit: MutableRefObject<(() => void) | undefined>;
} | null>(null);

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
  const exit = useRef<(() => void) | undefined>(undefined);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const requested = open ?? localOpen;
  const openNow = useRef(requested && !dismissed);
  openNow.current = requested && !dismissed;
  const mounted = useRef(true);

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
    exit.current?.();
    exit.current = undefined;
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
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exit.current?.();
    };
  }, []);

  return (
    <MenuState.Provider value={{ open: openNow.current, openNow, mounted, replaced, exit }}>
      <Menu.Root {...props} open={requested && !dismissed} onOpenChange={setOpen} />
    </MenuState.Provider>
  );
}

export const Content = forwardRef<
  ComponentRef<typeof Menu.Content>,
  ComponentPropsWithoutRef<typeof Menu.Content>
>(function Content({ onCloseAutoFocus, children, ...props }, ref) {
  const owner = useContext(MenuState)!;
  const { open, replaced } = owner;
  const state = useRef(owner);
  state.current = owner;
  const content = useRef<HTMLElement | null>(null);
  const enter = useRef<(() => void) | undefined>(undefined);
  const attach = useCallback(
    (node: ComponentRef<typeof Menu.Content> | null) => {
      if (
        !node &&
        content.current &&
        state.current.mounted.current &&
        !state.current.openNow.current &&
        !state.current.replaced.current
      ) {
        const exits = state.current.exit;
        exits.current?.();
        let cancel: (() => void) | undefined;
        cancel = animateDropdownExit(content.current, () => {
          if (exits.current === cancel) exits.current = undefined;
        });
        exits.current = cancel;
      }
      enter.current?.();
      enter.current = node ? animateDropdownEnter(node) : undefined;
      content.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <Menu.Content
      {...props}
      ref={attach}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-menu-replaced={replaced?.current || undefined}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        // Closing the previous menu must not steal focus from the new menu.
        if (replaced?.current || activeMenu) event.preventDefault();
        const closed = event.target instanceof HTMLElement ? event.target : null;
        const trigger = closed
          ? [...document.querySelectorAll<HTMLElement>('[aria-controls]')].find(
              (node) => node.getAttribute('aria-controls') === closed.id,
            )
          : undefined;
        const active = document.activeElement;
        if (
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          active !== trigger &&
          active !== trigger?.closest('dialog') &&
          !closed?.contains(active)
        )
          event.preventDefault();
      }}
    >
      <div className="dropdown-scroll">{children}</div>
    </Menu.Content>
  );
});

export { Root as DropdownMenu, Content as DropdownMenuContent };
