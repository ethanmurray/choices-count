import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function CameraTest() {
  const [hasPermission, setHasPermission] = useState(null);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);

  // Connect stream to video element when both are available
  useEffect(() => {
    if (stream && videoRef.current) {
      console.log('Connecting stream to video element');
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(err => {
        console.error('Error playing video:', err);
      });
    }
  }, [stream]);

  const requestCameraPermission = async () => {
    try {
      console.log('Requesting camera permission...');

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia not supported on this browser');
      }

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      console.log('Camera permission granted!', stream);
      setHasPermission(true);
      setStream(stream);
      setCameraReady(true);
      setError(null);

    } catch (err) {
      console.error('Camera permission error:', err);
      setError(err.message);
      setHasPermission(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Camera Test</Text>

      {hasPermission === null && (
        <TouchableOpacity style={styles.button} onPress={requestCameraPermission}>
          <Text style={styles.buttonText}>Test Camera Access</Text>
        </TouchableOpacity>
      )}

      {hasPermission === false && (
        <View>
          <Text style={styles.error}>Camera access denied</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <TouchableOpacity style={styles.button} onPress={requestCameraPermission}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {hasPermission === true && (
        <View>
          <Text style={styles.success}>Camera access granted!</Text>
          {cameraReady && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={styles.video}
              onLoadedMetadata={() => console.log('Video metadata loaded')}
              onError={(e) => console.error('Video error:', e)}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  success: {
    color: 'green',
    fontSize: 18,
    marginBottom: 10,
  },
  error: {
    color: 'red',
    fontSize: 18,
    marginBottom: 10,
  },
  errorDetail: {
    color: 'red',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  video: {
    width: 320,
    height: 240,
    backgroundColor: 'black',
    marginTop: 10,
  },
});