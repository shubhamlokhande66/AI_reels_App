import { StyleSheet, Text, View } from "react-native";
import type { ComponentType, ReactElement } from "react";
import MaskedViewClass from "@react-native-masked-view/masked-view";
import { Gold } from "./Gold";

// the library's class type predates React 19's JSX types
const MaskedView = MaskedViewClass as unknown as ComponentType<{ style?: object; maskElement: ReactElement; children: ReactElement }>;

/** Words in the gold gradient (the website's bg-gold bg-clip-text). `before`: plain words in front, on the same lines
 * (so a title can wrap with its gold part inline). `className`: the type (size, weight, line height, alignment). */
export function GoldText({ text, before, className = "" }: { text: string; before?: string; className?: string }) {
  return (
    <View>
      <Text className={`text-foreground ${className}`}>{before && `${before} `}<Text style={{ color: "transparent" }}>{text}</Text></Text>
      <MaskedView style={StyleSheet.absoluteFill} maskElement={<Text className={className}>{before && <Text style={{ color: "transparent" }}>{`${before} `}</Text>}<Text style={{ color: "#000" }}>{text}</Text></Text>}>
        <Gold />
      </MaskedView>
    </View>
  );
}
