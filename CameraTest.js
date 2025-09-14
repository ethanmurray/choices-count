import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

export default function CameraTest() {
  const [hasPermission, setHasPermission] = useState(null);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle, uploading, success, error
  const [analysisResults, setAnalysisResults] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState('idle'); // idle, analyzing, success, error
  const [lastUploadedFilename, setLastUploadedFilename] = useState(null);
  const [productResults, setProductResults] = useState(null);
  const [productSearchStatus, setProductSearchStatus] = useState('idle'); // idle, searching, success, error
  const [openaiResults, setOpenaiResults] = useState(null);
  const [openaiAnalysisStatus, setOpenaiAnalysisStatus] = useState('idle'); // idle, analyzing, success, error
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

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

  const takePhoto = () => {
    try {
      console.log('Taking photo...');

      // Check if video and canvas are ready
      if (!videoRef.current || !canvasRef.current || !cameraReady) {
        console.error('Video or canvas not ready');
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      // Set canvas size to match video
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;

      // Draw current video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to data URL
      const imageData = canvas.toDataURL('image/png');
      setCapturedImage(imageData);
      setUploadStatus('idle'); // Reset upload status for new image
      console.log('Photo captured successfully');

    } catch (err) {
      console.error('Error taking photo:', err);
    }
  };

  const saveImageForProcessing = async () => {
    if (!capturedImage) {
      console.error('No image to save');
      return;
    }

    try {
      setUploadStatus('uploading');
      console.log('Saving image for processing...');

      // Convert data URL to blob
      console.log('Converting image data to blob...');
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      console.log('Blob created:', blob.size, 'bytes, type:', blob.type);

      // Create form data for upload
      const formData = new FormData();
      const filename = `food-scan-${Date.now()}.png`;
      formData.append('image', blob, filename);
      formData.append('timestamp', new Date().toISOString());
      console.log('FormData prepared for upload, filename:', filename);

      // Send to backend endpoint
      console.log('Sending request to backend...');
      const uploadResponse = await fetch('http://localhost:3001/api/images/upload', {
        method: 'POST',
        body: formData,
      });

      console.log('Upload response received:', uploadResponse.status, uploadResponse.statusText);

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Upload failed response:', errorText);
        throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
      }

      const result = await uploadResponse.json();
      console.log('Image saved successfully:', result);
      setUploadStatus('success');

      // Store the uploaded filename for analysis
      if (result.data && result.data.filename) {
        setLastUploadedFilename(result.data.filename);
        console.log('Filename stored for analysis:', result.data.filename);
      } else {
        console.warn('No filename received from upload response');
      }

    } catch (err) {
      console.error('Error saving image:', err);
      console.error('Error stack:', err.stack);
      setUploadStatus('error');
    }
  };

  const analyzeImage = async () => {
    if (!lastUploadedFilename) {
      console.error('No uploaded image to analyze. Please save the image first.');
      setAnalysisStatus('error');
      return;
    }

    try {
      setAnalysisStatus('analyzing');
      setAnalysisResults(null);
      console.log('Analyzing image:', lastUploadedFilename);

      const analysisResponse = await fetch('http://localhost:3001/api/images/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: lastUploadedFilename
        }),
      });

      console.log('Analysis response received:', analysisResponse.status, analysisResponse.statusText);

      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        console.error('Analysis failed response:', errorText);
        throw new Error(`Analysis failed: ${analysisResponse.status} - ${errorText}`);
      }

      const result = await analysisResponse.json();
      console.log('Analysis completed:', result);
      setAnalysisResults(result.data);
      setAnalysisStatus('success');

      // Automatically search for products if food items were detected
      if (result.data && result.data.results && result.data.results.foodItems && result.data.results.foodItems.length > 0) {
        await searchProducts(result.data.results.foodItems);
      }

    } catch (err) {
      console.error('Error analyzing image:', err);
      setAnalysisStatus('error');
    }
  };

  const searchProducts = async (foodItems) => {
    try {
      setProductSearchStatus('searching');
      setProductResults(null);
      console.log('Searching for products...', foodItems);

      const searchResponse = await fetch('http://localhost:3001/api/products/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          foodItems: foodItems
        }),
      });

      console.log('Product search response received:', searchResponse.status, searchResponse.statusText);

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Product search failed response:', errorText);
        throw new Error(`Product search failed: ${searchResponse.status} - ${errorText}`);
      }

      const result = await searchResponse.json();
      console.log('Product search completed:', result);
      setProductResults(result.data);
      setProductSearchStatus('success');

    } catch (err) {
      console.error('Error searching products:', err);
      setProductSearchStatus('error');
    }
  };

  const analyzeImageOpenAI = async () => {
    if (!lastUploadedFilename) {
      console.error('No uploaded image to analyze. Please save the image first.');
      setOpenaiAnalysisStatus('error');
      return;
    }

    try {
      setOpenaiAnalysisStatus('analyzing');
      setOpenaiResults(null);
      console.log('Analyzing image with OpenAI:', lastUploadedFilename);

      const analysisResponse = await fetch('http://localhost:3001/api/images/analyze-openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: lastUploadedFilename
        }),
      });

      console.log('OpenAI analysis response received:', analysisResponse.status, analysisResponse.statusText);

      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        console.error('OpenAI analysis failed response:', errorText);
        throw new Error(`OpenAI analysis failed: ${analysisResponse.status} - ${errorText}`);
      }

      const result = await analysisResponse.json();
      console.log('OpenAI analysis completed:', result);
      setOpenaiResults(result.data);
      setOpenaiAnalysisStatus('success');

      // Automatically search for products if food items were detected
      if (result.data && result.data.results && result.data.results.foodItems && result.data.results.foodItems.length > 0) {
        await searchProducts(result.data.results.foodItems);
      }

    } catch (err) {
      console.error('Error analyzing image with OpenAI:', err);
      setOpenaiAnalysisStatus('error');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
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
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={styles.video}
                onLoadedMetadata={() => console.log('Video metadata loaded')}
                onError={(e) => console.error('Video error:', e)}
              />
              <canvas
                ref={canvasRef}
                style={{ display: 'none' }}
              />
              <TouchableOpacity style={styles.button} onPress={takePhoto}>
                <Text style={styles.buttonText}>Take Photo</Text>
              </TouchableOpacity>
            </>
          )}
          {capturedImage && (
            <>
              <img
                src={capturedImage}
                alt="Captured"
                style={styles.capturedImage}
              />
              <TouchableOpacity
                style={[
                  styles.button,
                  uploadStatus === 'uploading' && styles.buttonDisabled
                ]}
                onPress={saveImageForProcessing}
                disabled={uploadStatus === 'uploading'}
              >
                <Text style={styles.buttonText}>
                  {uploadStatus === 'uploading' ? 'Saving...' : 'Save for Processing'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button,
                  analysisStatus === 'analyzing' && styles.buttonDisabled
                ]}
                onPress={analyzeImage}
                disabled={analysisStatus === 'analyzing'}
              >
                <Text style={styles.buttonText}>
                  {analysisStatus === 'analyzing' ? 'Analyzing...' : 'Analyze with Google Vision'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.openaiButton,
                  openaiAnalysisStatus === 'analyzing' && styles.buttonDisabled
                ]}
                onPress={analyzeImageOpenAI}
                disabled={openaiAnalysisStatus === 'analyzing'}
              >
                <Text style={styles.buttonText}>
                  {openaiAnalysisStatus === 'analyzing' ? 'Analyzing with AI...' : 'Analyze with OpenAI Vision'}
                </Text>
              </TouchableOpacity>

              {uploadStatus === 'success' && (
                <Text style={styles.success}>Image saved successfully!</Text>
              )}

              {uploadStatus === 'error' && (
                <Text style={styles.error}>Failed to save image. Please try again.</Text>
              )}

              {analysisStatus === 'success' && analysisResults && (
                <View style={styles.analysisContainer}>
                  <Text style={styles.analysisTitle}>Analysis Results:</Text>

                  {analysisResults.results.foodItems.length > 0 && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Food Items Detected:</Text>
                      {analysisResults.results.foodItems.map((item, index) => (
                        <Text key={index} style={styles.resultItem}>
                          • {item.name} ({item.confidence}% confident)
                        </Text>
                      ))}
                    </View>
                  )}

                  {analysisResults.results.extractedText && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Text Found:</Text>
                      <Text style={styles.extractedText}>
                        {analysisResults.results.extractedText.fullText}
                      </Text>
                    </View>
                  )}

                  {analysisResults.results.objects.length > 0 && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Objects Detected:</Text>
                      {analysisResults.results.objects.map((obj, index) => (
                        <Text key={index} style={styles.resultItem}>
                          • {obj.name} ({obj.confidence}% confident)
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {analysisStatus === 'error' && (
                <Text style={styles.error}>Failed to analyze image. Please try again.</Text>
              )}

              {openaiAnalysisStatus === 'success' && openaiResults && (
                <View style={styles.openaiContainer}>
                  <Text style={styles.openaiTitle}>OpenAI Analysis Results:</Text>

                  {openaiResults.results.conversationalSummary && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>AI Analysis Summary:</Text>
                      <Text style={styles.conversationalText}>
                        {openaiResults.results.conversationalSummary}
                      </Text>
                    </View>
                  )}

                  {openaiResults.results.foodItems && openaiResults.results.foodItems.length > 0 && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Food Items Detected:</Text>
                      {openaiResults.results.foodItems.map((item, index) => (
                        <Text key={index} style={styles.resultItem}>
                          • {item.name} ({item.confidence}% confident)
                        </Text>
                      ))}
                    </View>
                  )}

                  {openaiResults.results.nutritionalAnalysis && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Nutritional Information:</Text>
                      <Text style={styles.nutritionalText}>
                        {JSON.stringify(openaiResults.results.nutritionalAnalysis, null, 2)}
                      </Text>
                    </View>
                  )}

                  {openaiResults.results.culturalContext && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Cultural Context:</Text>
                      <Text style={styles.resultItem}>
                        {openaiResults.results.culturalContext}
                      </Text>
                    </View>
                  )}

                  {openaiResults.results.dietaryConsiderations && (
                    <View style={styles.resultSection}>
                      <Text style={styles.sectionTitle}>Dietary Information:</Text>
                      <Text style={styles.resultItem}>
                        {openaiResults.results.dietaryConsiderations}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {openaiAnalysisStatus === 'error' && (
                <Text style={styles.error}>Failed to analyze image with OpenAI. Please try again.</Text>
              )}

              {productSearchStatus === 'searching' && (
                <Text style={styles.searchingText}>Searching for products...</Text>
              )}

              {productSearchStatus === 'success' && productResults && (
                <View style={styles.productContainer}>
                  <Text style={styles.productTitle}>Related Products:</Text>
                  {productResults.searchResults.map((searchResult, index) => (
                    <View key={index} style={styles.productSearchSection}>
                      <Text style={styles.productSearchTitle}>
                        "{searchResult.searchTerm}" ({searchResult.detectedConfidence}% confident)
                      </Text>
                      {searchResult.products.length > 0 ? (
                        searchResult.products.map((product, productIndex) => (
                          <TouchableOpacity
                            key={productIndex}
                            style={styles.productLink}
                            onPress={() => {
                              if (typeof window !== 'undefined') {
                                window.open(product.url, '_blank');
                              }
                            }}
                          >
                            <Text style={styles.productName}>
                              {product.name} {product.brand && `(${product.brand})`}
                            </Text>
                            <Text style={styles.productUrl}>View on Open Food Facts →</Text>
                          </TouchableOpacity>
                        ))
                      ) : (
                        <Text style={styles.noProductsText}>No products found</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {productSearchStatus === 'error' && (
                <Text style={styles.error}>Failed to search for products. Please try again.</Text>
              )}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40,
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
  capturedImage: {
    width: 320,
    height: 240,
    marginTop: 10,
    border: '2px solid #007AFF',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  analysisContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dee2e6',
    width: 320,
  },
  analysisTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#007AFF',
  },
  resultSection: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  resultItem: {
    fontSize: 14,
    color: '#666',
    marginLeft: 10,
    marginBottom: 2,
  },
  extractedText: {
    fontSize: 14,
    color: '#666',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    fontFamily: 'monospace',
  },
  searchingText: {
    fontSize: 16,
    color: '#007AFF',
    marginTop: 10,
    textAlign: 'center',
  },
  productContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b3d9ff',
    width: 320,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#0066cc',
  },
  productSearchSection: {
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  productSearchTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  productLink: {
    backgroundColor: '#fff',
    padding: 10,
    marginBottom: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  productName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  productUrl: {
    fontSize: 12,
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  noProductsText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    marginLeft: 10,
  },
  openaiButton: {
    backgroundColor: '#28a745', // Green for OpenAI
  },
  openaiContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f8fff8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#28a745',
    width: 320,
  },
  openaiTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#28a745',
  },
  conversationalText: {
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    lineHeight: 20,
  },
  nutritionalText: {
    fontSize: 12,
    color: '#666',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    fontFamily: 'monospace',
  },
});