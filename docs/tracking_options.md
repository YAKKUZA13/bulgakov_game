# Tracking alternatives (web-only)

This project currently uses AlvaAR (visual SLAM) plus depth-based plane fitting. If tracking quality is still insufficient, the following web-only alternatives can be tested as optional additions.

## Marker-based anchors (high stability, low generality)
- **AprilTag** or **ArUco** markers (OpenCV.js or JS/WASM implementations)
- Pros: very stable pose, fast re-acquisition, works in low-texture scenes
- Cons: requires printed markers; limited to marker locations
- Integration idea: detect marker pose and use it to correct/lock SLAM drift

## Optical flow + keypoints (medium weight)
- **OpenCV.js**: Lucas-Kanade optical flow + ORB/FAST features
- Pros: can stabilize pose between SLAM updates, good for short-term tracking
- Cons: heavy download (~7-8MB wasm), CPU/GPU cost on mobile
- Integration idea: use flow to smooth motion and improve short-term stability

## Model-based object tracking (niche)
- **MediaPipe** (limited 2D/3D tracking models)
- Pros: good for specific objects (hands, face, body)
- Cons: not general-purpose 6DOF tracking for arbitrary objects

## Рекомендации по следующему шагу
1. Добавить режим с маркерами как переключатель (AprilTag/ArUco) для стабильных якорей.
2. Измерить производительность и качество на 1–2 эталонных сценах.
