const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const vision = require('@google-cloud/vision');
const { MockVisionClient } = require('./vision-mock');
const OpenAI = require('openai');

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

// Initialize OpenAI client (if API key is available)
let openaiClient;
if (process.env.OPENAI_API_KEY) {
  try {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('OpenAI Vision API available');
  } catch (error) {
    console.log('OpenAI initialization failed:', error.message);
  }
} else {
  console.log('No OpenAI API key found - OpenAI Vision will not be available');
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

// Analyze image with OpenAI Vision API
app.post('/api/images/analyze-openai', async (req, res) => {
  try {
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        error: 'Filename is required'
      });
    }

    // Check if OpenAI client is available
    if (!openaiClient) {
      return res.status(503).json({
        error: 'OpenAI Vision API not available',
        details: 'OpenAI API key not configured'
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

    console.log(`Analyzing image with OpenAI: ${filename}`);

    // Convert image to base64 for OpenAI API
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/png'; // Assuming PNG format

    // Call OpenAI Vision API with detailed food analysis prompt
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this food image in detail. Please provide:

1. **Food Items**: List all food items you can identify with confidence levels
2. **Portion Sizes**: Estimate portion sizes using visual cues and scale references in the image
3. **Nutritional Analysis**: Provide estimated nutritional information (calories, protein, carbs, fat, fiber)
4. **Food Quality**: Assess freshness, preparation method, and overall quality
5. **Cultural Context**: Identify cuisine type or cultural background if apparent
6. **Dietary Information**: Note any dietary considerations (vegetarian, vegan, gluten-free, etc.)
7. **Ingredients**: List likely ingredients used in preparation
8. **Serving Suggestions**: Provide context about typical serving sizes

Please structure your response as JSON with clear categories. Be specific about confidence levels for your identifications.`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.1
    });

    // Parse OpenAI response
    const analysisText = response.choices[0].message.content;

    // Try to parse JSON response, fallback to structured text parsing
    let structuredAnalysis;
    try {
      structuredAnalysis = JSON.parse(analysisText);
    } catch (jsonError) {
      // If not valid JSON, create structured response from text
      structuredAnalysis = {
        rawAnalysis: analysisText,
        foodItems: extractFoodItems(analysisText),
        nutritionalInfo: extractNutritionalInfo(analysisText),
        portionSizes: extractPortionInfo(analysisText),
        confidence: 'high'
      };
    }

    const analysisResults = {
      filename,
      timestamp: new Date().toISOString(),
      provider: 'OpenAI GPT-4 Vision',
      results: {
        detailedAnalysis: structuredAnalysis,
        conversationalSummary: analysisText,

        // Extract food items in compatible format for Open Food Facts integration
        foodItems: extractCompatibleFoodItems(structuredAnalysis, analysisText),

        // Nutritional insights
        nutritionalAnalysis: structuredAnalysis.nutritionalInfo || extractNutritionalInfo(analysisText),

        // Additional OpenAI-specific insights
        culturalContext: structuredAnalysis.culturalContext || null,
        dietaryConsiderations: structuredAnalysis.dietaryInformation || null,
        qualityAssessment: structuredAnalysis.foodQuality || null,

        // Metadata
        processingTime: new Date().toISOString(),
        apiProvider: 'OpenAI GPT-4 Vision'
      }
    };

    console.log(`OpenAI analysis completed for ${filename}`);

    res.json({
      success: true,
      data: analysisResults
    });

  } catch (error) {
    console.error('Error analyzing image with OpenAI:', error);
    res.status(500).json({
      error: 'Failed to analyze image with OpenAI',
      details: error.message
    });
  }
});

// Helper functions for parsing OpenAI response
function extractFoodItems(text) {
  // Simple food item extraction from text
  const foodPatterns = [
    /food items?[:\s]*([^\.]+)/i,
    /identified?[:\s]*([^\.]+)/i,
    /contains?[:\s]*([^\.]+)/i
  ];

  const items = [];
  for (const pattern of foodPatterns) {
    const match = text.match(pattern);
    if (match) {
      const foodText = match[1];
      const foodItems = foodText.split(/[,;]/).map(item => item.trim());
      items.push(...foodItems);
    }
  }

  return items.slice(0, 5).map((item, index) => ({
    name: item,
    confidence: Math.max(60, 95 - index * 10), // Decreasing confidence
    category: 'detected_food'
  }));
}

function extractNutritionalInfo(text) {
  const nutritionPatterns = {
    calories: /(\d+)\s*(?:cal|calories)/i,
    protein: /(\d+(?:\.\d+)?)\s*g?\s*protein/i,
    carbs: /(\d+(?:\.\d+)?)\s*g?\s*carb/i,
    fat: /(\d+(?:\.\d+)?)\s*g?\s*fat/i
  };

  const nutrition = {};
  for (const [key, pattern] of Object.entries(nutritionPatterns)) {
    const match = text.match(pattern);
    if (match) {
      nutrition[key] = match[1];
    }
  }

  return Object.keys(nutrition).length > 0 ? nutrition : null;
}

function extractPortionInfo(text) {
  const portionPatterns = [
    /portion[:\s]*([^\.]+)/i,
    /serving[:\s]*([^\.]+)/i,
    /amount[:\s]*([^\.]+)/i
  ];

  for (const pattern of portionPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function extractCompatibleFoodItems(structuredData, text) {
  // Extract food items in format compatible with Open Food Facts integration
  if (structuredData && structuredData.foodItems && Array.isArray(structuredData.foodItems)) {
    return structuredData.foodItems.map(item => ({
      name: typeof item === 'string' ? item : item.name || item.food,
      confidence: item.confidence || 80,
      category: 'detected_food'
    }));
  }

  // Fallback to text extraction
  return extractFoodItems(text);
}

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