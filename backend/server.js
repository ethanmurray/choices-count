const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const vision = require('@google-cloud/vision');
const { MockVisionClient } = require('./vision-mock');

const app = express();
const PORT = 3001;

// Initialize Vision client (Google Cloud or Mock for development)
let visionClient;

// Check if Google Cloud credentials are available
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT) {
  try {
    visionClient = new vision.ImageAnnotatorClient();
    console.log('Using Google Cloud Vision API');
  } catch (error) {
    console.log('Google Cloud Vision API failed, using Mock Vision API');
    visionClient = new MockVisionClient();
  }
} else {
  // No credentials found, use mock client for development/testing
  console.log('No Google Cloud credentials found, using Mock Vision API');
  visionClient = new MockVisionClient();
}

// Enable CORS for frontend requests
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');

    // Ensure uploads directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use original filename or create one with timestamp
    const filename = file.originalname || `food-scan-${Date.now()}.png`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Image upload endpoint
app.post('/api/images/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided'
      });
    }

    const imageInfo = {
      id: Date.now().toString(),
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
      timestamp: req.body.timestamp || new Date().toISOString(),
      status: 'uploaded'
    };

    console.log('Image uploaded successfully:', imageInfo);

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: imageInfo
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to upload image',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// List uploaded images (for future ML processing)
app.get('/api/images', (req, res) => {
  try {
    const uploadsDir = path.join(__dirname, 'uploads');

    if (!fs.existsSync(uploadsDir)) {
      return res.json({ images: [] });
    }

    const files = fs.readdirSync(uploadsDir)
      .filter(file => file.match(/\.(jpg|jpeg|png|gif)$/i))
      .map(file => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);

        return {
          filename: file,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created); // Newest first

    res.json({
      images: files,
      count: files.length
    });

  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({
      error: 'Failed to list images',
      details: error.message
    });
  }
});

// Analyze image with Google Vision API
app.post('/api/images/analyze', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        error: 'Filename is required'
      });
    }

    const imagePath = path.join(__dirname, 'uploads', filename);

    // Check if image file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        error: 'Image file not found',
        filename
      });
    }

    console.log(`Analyzing image: ${filename}`);

    // Perform Google Vision API analysis
    const [labelResult] = await visionClient.labelDetection(imagePath);
    const [textResult] = await visionClient.textDetection(imagePath);
    const [objectResult] = await visionClient.objectLocalization(imagePath);

    // Extract and format results
    const labels = labelResult.labelAnnotations || [];
    const textAnnotations = textResult.textAnnotations || [];
    const objects = objectResult.localizedObjectAnnotations || [];

    const analysisResults = {
      filename,
      timestamp: new Date().toISOString(),
      results: {
        // Food-related labels with confidence scores
        foodItems: labels
          .filter(label => label.score > 0.6)
          .map(label => ({
            name: label.description,
            confidence: Math.round(label.score * 100),
            category: 'detected_food'
          })),

        // Extracted text from packaging
        extractedText: textAnnotations.length > 0 ? {
          fullText: textAnnotations[0].description || '',
          detectedWords: textAnnotations.slice(1).map(text => ({
            text: text.description,
            confidence: Math.round((text.confidence || 0.8) * 100)
          }))
        } : null,

        // Detected objects
        objects: objects
          .filter(obj => obj.score > 0.5)
          .map(obj => ({
            name: obj.name,
            confidence: Math.round(obj.score * 100),
            category: 'detected_object'
          })),

        // Analysis metadata
        totalLabels: labels.length,
        processingTime: new Date().toISOString(),
        apiProvider: 'Google Cloud Vision'
      }
    };

    console.log(`Analysis completed for ${filename}:`, {
      labels: labels.length,
      textDetected: textAnnotations.length > 0,
      objects: objects.length
    });

    res.json({
      success: true,
      data: analysisResults
    });

  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({
      error: 'Failed to analyze image',
      details: error.message
    });
  }
});

// Search Open Food Facts for product information
app.post('/api/products/search', async (req, res) => {
  try {
    const { foodItems } = req.body;

    if (!foodItems || !Array.isArray(foodItems) || foodItems.length === 0) {
      return res.status(400).json({
        error: 'foodItems array is required'
      });
    }

    console.log('Searching Open Food Facts for food items:', foodItems.map(item => item.name));

    const productResults = [];

    // Search for each detected food item
    for (const foodItem of foodItems) {
      try {
        const searchTerm = encodeURIComponent(foodItem.name);
        const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${searchTerm}&json=1&page_size=5`;

        console.log(`Searching for "${foodItem.name}": ${searchUrl}`);

        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.products && data.products.length > 0) {
          const products = data.products.slice(0, 3).map(product => ({
            id: product.id || product._id,
            name: product.product_name || product.product_name_en || 'Unknown Product',
            brand: product.brands || '',
            url: `https://world.openfoodfacts.org/product/${product.code || product.id}`,
            image: product.image_url || product.image_front_url,
            nutritionGrade: product.nutrition_grades || product.nutriscore_grade,
            categories: product.categories || '',
            confidence: foodItem.confidence
          }));

          productResults.push({
            searchTerm: foodItem.name,
            detectedConfidence: foodItem.confidence,
            products
          });
        } else {
          productResults.push({
            searchTerm: foodItem.name,
            detectedConfidence: foodItem.confidence,
            products: []
          });
        }
      } catch (searchError) {
        console.error(`Error searching for "${foodItem.name}":`, searchError);
        productResults.push({
          searchTerm: foodItem.name,
          detectedConfidence: foodItem.confidence,
          products: [],
          error: searchError.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        searchResults: productResults,
        totalSearches: foodItems.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({
      error: 'Failed to search products',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
  }

  res.status(500).json({
    error: 'Internal server error',
    details: error.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Upload endpoint: http://localhost:${PORT}/api/images/upload`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});