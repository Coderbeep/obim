const keyframes: Keyframe[] = [
  { offset: 0, transform: "translate3d(0, 0, 0)" },
  { offset: 0.2, transform: "translate3d(-1.5px, 0, 0)" },
  { offset: 0.4, transform: "translate3d(1.5px, 0, 0)" },
  { offset: 0.6, transform: "translate3d(-1.5px, 0, 0)" },
  { offset: 0.8, transform: "translate3d(1.5px, 0, 0)" },
  { offset: 1, transform: "translate3d(0, 0, 0)" },
];

export const shakeElement = (element: Element | null) => {
  element?.animate(keyframes, { duration: 450, easing: "ease-in-out" });
};
