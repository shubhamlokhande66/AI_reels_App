import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, Platform, ScrollView, TextInput, View, type ScrollViewProps } from "react-native";

/** A form's scrolling page: the field being typed in stays above the keyboard. The page gets the keyboard's height as room
 * at its end, then scrolls just enough to show the field (Android draws edge to edge, so the window does not shrink for it). */
export function KeyboardScroll({ children, ...rest }: ScrollViewProps) {
  const page = useRef<ComponentRef<typeof ScrollView>>(null), scrolled = useRef(0), [room, setRoom] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const shown = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", ({ endCoordinates: k }) => {
      setRoom(k.height);
      setTimeout(() => {
        TextInput.State.currentlyFocusedInput()?.measureInWindow((_x, y, _w, h) => {
          const hidden = y + h + 24 - k.screenY;
          if (hidden > 0) page.current?.scrollTo({ y: scrolled.current + hidden, animated: true });
        });
      }, 80); // the room is drawn first
    });
    const hidden = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setRoom(0));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return (
    <ScrollView ref={page} keyboardShouldPersistTaps="handled" scrollEventThrottle={32} onScroll={(e) => { scrolled.current = e.nativeEvent.contentOffset.y; }} {...rest}>
      {children}
      <View style={{ height: room }} />
    </ScrollView>
  );
}
