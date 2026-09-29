import React, { useEffect, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

export const AnimatedSafeArea = Animated.createAnimatedComponent(SafeAreaView);
export const AnimatedKeyboardAvoidingView = Animated.createAnimatedComponent(KeyboardAvoidingView);

export function SlideModal({ visible, onClose, direction, overlayStyle, backdropTestID, children }: any) {
  const reduce = useReducedMotion(), { width, height } = useWindowDimensions();
  const [transition, setTransition] = useState({ visible, closing: false });
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  // Keep the closing panel mounted until its animation finishes. A new open
  // cancels that transition before rendering, including with reduced motion.
  if (transition.visible !== visible || (transition.closing && reduce)) {
    setTransition({ visible, closing: transition.visible && !visible && !reduce });
  }
  const present = visible || (transition.closing && !reduce);
  useEffect(() => {
    progress.stopAnimation();
    if (reduce) { progress.setValue(visible ? 1 : 0); return; }
    if (!present) return;
    const animation = Animated.timing(progress, { toValue: visible ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start(({ finished }) => { if (finished && !visible) setTransition(current => current.visible ? current : { visible: false, closing: false }); });
    return () => animation.stop();
  }, [visible, present, reduce, progress]);
  const offset = direction === 'left' ? -Math.min(width * 0.84, 320) : height * 0.8;
  const transform = [{ [direction === 'left' ? 'translateX' : 'translateY']: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }];
  return <Modal visible={present} transparent animationType="none" onRequestClose={onClose}><View style={overlayStyle}><Pressable testID={backdropTestID} style={StyleSheet.absoluteFill} onPress={onClose} />{children({ transform })}</View></Modal>;
}
