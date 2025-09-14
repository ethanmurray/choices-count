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
    const { filename, productDescription } = req.body;

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

    // Create dynamic prompt based on product description
    const basePrompt = `Analyze this food image for MULTIPLE PRODUCTS with detailed spatial awareness. Provide comprehensive analysis:

**IMPORTANT**: This image may contain multiple distinct food products/items. Analyze each one separately.`;

    const targetedPrompt = productDescription
      ? `${basePrompt}

**SPECIFIC FOCUS**: The user is particularly interested in finding information about: "${productDescription}"
- Pay special attention to any products matching this description
- Provide extra detail for organic certification, fair trade status, and brand information for this product
- Generate optimized search terms specifically for this product to find it in food databases`
      : basePrompt;

    // Call OpenAI Vision API with enhanced prompt
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${targetedPrompt}

Return a JSON response with this exact structure:
{
  "products": [
    {
      "id": "product_1",
      "name": "Product Name",
      "type": "product_type", // "packaged_food", "fresh_produce", "prepared_food", "beverage", etc.
      "position": "spatial_description", // "left side", "center", "background", etc.
      "quantity": 1, // number of identical items visible
      "confidence": 95, // 0-100 confidence score
      "nutritionalInfo": {
        "calories": 150,
        "protein": "5g",
        "carbs": "30g",
        "fat": "2g",
        "fiber": "3g"
      },
      "portionSize": "1 cup / 240ml",
      "brandInfo": "visible brand or packaging text if readable",
      "ingredients": ["ingredient1", "ingredient2"],
      "dietaryFlags": ["vegetarian", "gluten-free"], // array of applicable flags
      "organicStatus": "certified_organic/likely_organic/conventional/unknown", // organic certification status
      "fairTradeStatus": "certified_fair_trade/likely_fair_trade/conventional/unknown", // fair trade status
      "certificationInfo": "specific certification text or logos visible",
      "freshness": "fresh/good/poor quality assessment",
      "preparationMethod": "raw/cooked/processed description",
      "openFoodFactsSearchTerms": ["primary_search_term", "alt_term"] // optimized search terms for Open Food Facts
    }
  ],
  "sceneAnalysis": {
    "totalProducts": 2,
    "sceneType": "grocery_haul/meal_prep/restaurant_plate/etc",
    "culturalContext": "cuisine type or cultural background",
    "setting": "kitchen/store/restaurant/etc",
    "lightingQuality": "good/poor for analysis",
    "imageQuality": "clear/blurry/partial view"
  },
  "aggregateNutrition": {
    "totalCalories": 300,
    "totalProtein": "10g",
    "totalCarbs": "60g",
    "totalFat": "4g"
  },
  "searchableTerms": ["term1", "term2"], // best terms for product database search
  "recommendations": "suggestions for portion control, preparation, or health considerations"
}

**KEY REQUIREMENTS**:
1. Identify EACH DISTINCT product separately - don't group similar items
2. Count identical items (e.g., "3 apples" = quantity: 3)
3. Use spatial descriptions for position awareness
4. Provide individual nutrition estimates per product
5. Extract any visible text/branding for product identification
6. Focus on products that can be found in food databases
7. Be specific about packaging vs. contents (e.g., "yogurt container" vs. "yogurt")
8. **ORGANIC/FAIR TRADE DETECTION**: Carefully examine labels for organic certification logos (USDA Organic, EU Organic, etc.) and Fair Trade certifications
9. **OPTIMIZED SEARCH TERMS**: Generate the best possible search terms for each product to find matches in Open Food Facts database
10. Include brand names, product names, and specific descriptors in search terms

Analyze the image thoroughly and provide detailed, structured data for each product.`
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

        // Multi-product analysis (new structured format)
        products: structuredAnalysis.products || [],
        sceneAnalysis: structuredAnalysis.sceneAnalysis || null,
        aggregateNutrition: structuredAnalysis.aggregateNutrition || null,
        searchableTerms: structuredAnalysis.searchableTerms || [],
        recommendations: structuredAnalysis.recommendations || null,

        // Extract food items in compatible format for Open Food Facts integration
        foodItems: extractCompatibleFoodItems(structuredAnalysis, analysisText),

        // Nutritional insights (legacy format + new aggregate)
        nutritionalAnalysis: structuredAnalysis.nutritionalInfo || structuredAnalysis.aggregateNutrition || extractNutritionalInfo(analysisText),

        // Additional OpenAI-specific insights (enhanced)
        culturalContext: structuredAnalysis.culturalContext || (structuredAnalysis.sceneAnalysis ? structuredAnalysis.sceneAnalysis.culturalContext : null),
        dietaryConsiderations: structuredAnalysis.dietaryInformation || null,
        qualityAssessment: structuredAnalysis.foodQuality || null,

        // Metadata
        processingTime: new Date().toISOString(),
        apiProvider: 'OpenAI GPT-4 Vision',

        // Multi-product metadata
        totalProducts: structuredAnalysis.products ? structuredAnalysis.products.length : (structuredAnalysis.sceneAnalysis ? structuredAnalysis.sceneAnalysis.totalProducts : 1),
        sceneType: structuredAnalysis.sceneAnalysis ? structuredAnalysis.sceneAnalysis.sceneType : null
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

// Extract organic and fair trade status from Open Food Facts labels
function extractCertificationStatus(product) {
  const labels = (product.labels || '').toLowerCase();
  const labelsTags = product.labels_tags || [];

  // Check for organic certification
  let organicStatus = 'unknown';
  const organicKeywords = ['organic', 'bio', 'organique', 'ecologique', 'biologique'];
  const organicTags = labelsTags.filter(tag =>
    tag.includes('organic') || tag.includes('bio') || tag.includes('en:organic')
  );

  if (organicTags.length > 0 || organicKeywords.some(keyword => labels.includes(keyword))) {
    organicStatus = 'certified_organic';
  }

  // Check for fair trade certification
  let fairTradeStatus = 'unknown';
  const fairTradeKeywords = ['fair trade', 'fairtrade', 'commerce equitable', 'max havelaar'];
  const fairTradeTags = labelsTags.filter(tag =>
    tag.includes('fair-trade') || tag.includes('fairtrade') || tag.includes('en:fair-trade')
  );

  if (fairTradeTags.length > 0 || fairTradeKeywords.some(keyword => labels.includes(keyword))) {
    fairTradeStatus = 'certified_fair_trade';
  }

  return {
    organicStatus,
    fairTradeStatus,
    certificationLabels: [...organicTags, ...fairTradeTags],
    allLabels: labels
  };
}

function extractCompatibleFoodItems(structuredData, text) {
  // Extract food items in format compatible with Open Food Facts integration
  // New structure: check for products array first
  if (structuredData && structuredData.products && Array.isArray(structuredData.products)) {
    return structuredData.products.map(product => ({
      name: product.name,
      confidence: product.confidence || 80,
      category: 'detected_food',
      type: product.type || 'unknown',
      position: product.position || 'unknown',
      quantity: product.quantity || 1,
      brandInfo: product.brandInfo || null,
      searchTerms: product.openFoodFactsSearchTerms || [product.name], // Use OpenAI-generated search terms
      organicStatus: product.organicStatus || 'unknown',
      fairTradeStatus: product.fairTradeStatus || 'unknown',
      certificationInfo: product.certificationInfo || null
    }));
  }

  // Legacy structure: check for foodItems array
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

    // Search for each detected food item using enhanced search terms
    for (const foodItem of foodItems) {
      try {
        // Use OpenAI-generated search terms if available, fallback to product name
        const searchTerms = foodItem.searchTerms || [foodItem.name];
        let bestResult = null;
        let bestSearchTerm = foodItem.name;

        // Try each search term until we find good results
        for (const term of searchTerms) {
          const searchTerm = encodeURIComponent(term);
          const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${searchTerm}&json=1&page_size=5`;

          console.log(`Searching for "${term}": ${searchUrl}`);

          const response = await fetch(searchUrl);
          const data = await response.json();

          if (data.products && data.products.length > 0) {
            const products = data.products.slice(0, 3).map(product => {
              const certificationInfo = extractCertificationStatus(product);
              return {
                id: product.id || product._id,
                name: product.product_name || product.product_name_en || 'Unknown Product',
                brand: product.brands || '',
                url: `https://world.openfoodfacts.org/product/${product.code || product.id}`,
                image: product.image_url || product.image_front_url,
                nutritionGrade: product.nutrition_grades || product.nutriscore_grade,
                categories: product.categories || '',
                labels: product.labels || '',
                labels_tags: product.labels_tags || [],
                // Enhanced certification information from Open Food Facts
                organicStatusOFF: certificationInfo.organicStatus,
                fairTradeStatusOFF: certificationInfo.fairTradeStatus,
                certificationLabels: certificationInfo.certificationLabels,
                // Combine OpenAI analysis with Open Food Facts data
                organicStatus: foodItem.organicStatus !== 'unknown' ? foodItem.organicStatus : certificationInfo.organicStatus,
                fairTradeStatus: foodItem.fairTradeStatus !== 'unknown' ? foodItem.fairTradeStatus : certificationInfo.fairTradeStatus,
                confidence: foodItem.confidence
              };
            });

            bestResult = {
              searchTerm: term,
              detectedConfidence: foodItem.confidence,
              organicStatus: foodItem.organicStatus,
              fairTradeStatus: foodItem.fairTradeStatus,
              certificationInfo: foodItem.certificationInfo,
              products
            };
            break; // Found good results, stop searching additional terms
          }
        }

        // Add the best result found or empty result if no matches
        if (bestResult) {
          productResults.push(bestResult);
        } else {
          productResults.push({
            searchTerm: foodItem.name,
            detectedConfidence: foodItem.confidence,
            organicStatus: foodItem.organicStatus,
            fairTradeStatus: foodItem.fairTradeStatus,
            certificationInfo: foodItem.certificationInfo,
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