// Mock Google Vision API responses for development/testing
// This allows testing the image analysis pipeline without Google Cloud credentials

const mockVisionResponses = {
  // Mock label detection response
  labelDetection: {
    labelAnnotations: [
      { description: 'Food', score: 0.95 },
      { description: 'Fruit', score: 0.89 },
      { description: 'Apple', score: 0.84 },
      { description: 'Produce', score: 0.78 },
      { description: 'Red', score: 0.72 },
      { description: 'Natural foods', score: 0.68 },
      { description: 'Snack', score: 0.63 }
    ]
  },

  // Mock text detection response
  textDetection: {
    textAnnotations: [
      {
        description: 'ORGANIC\nGALA APPLES\n$2.99/LB\nProduct of USA',
        confidence: 0.92
      },
      { description: 'ORGANIC', confidence: 0.95 },
      { description: 'GALA', confidence: 0.93 },
      { description: 'APPLES', confidence: 0.94 },
      { description: '$2.99/LB', confidence: 0.89 },
      { description: 'Product', confidence: 0.87 },
      { description: 'of', confidence: 0.85 },
      { description: 'USA', confidence: 0.91 }
    ]
  },

  // Mock object localization response
  objectLocalization: {
    localizedObjectAnnotations: [
      { name: 'Food', score: 0.91 },
      { name: 'Fruit', score: 0.87 },
      { name: 'Apple', score: 0.83 }
    ]
  }
};

// Create mock Vision client that mimics Google Cloud Vision API
class MockVisionClient {
  async labelDetection(imagePath) {
    console.log(`[MOCK] Analyzing labels for: ${imagePath}`);
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return [mockVisionResponses.labelDetection];
  }

  async textDetection(imagePath) {
    console.log(`[MOCK] Analyzing text for: ${imagePath}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    return [mockVisionResponses.textDetection];
  }

  async objectLocalization(imagePath) {
    console.log(`[MOCK] Analyzing objects for: ${imagePath}`);
    await new Promise(resolve => setTimeout(resolve, 400));
    return [mockVisionResponses.objectLocalization];
  }
}

module.exports = { MockVisionClient };