import fetch from "node-fetch";
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Available functions mapping
const functionMap = {
  getDatabaseInfo: getDatabaseInfo,
  dynamicSupabaseOperation: dynamicSupabaseOperation
};

// Initialize PostgreSQL client for Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function getDatabaseInfo(params) {
  // Extract tableName from the params object
  const tableName = params.tableName;
  const { data, error } = await supabase.from(tableName).select('id, description');
  if (error) {
    console.error("Error fetching data:", error);
    return { error: "Failed to retrieve data." };
  }
  return data;
}

// Dynamic Supabase Function Handler
async function dynamicSupabaseOperation(params) {
  try {
    // Validate required parameters
    if (!params.from || !params.action) {
      throw new Error('Missing required parameters: "from" and "action"');
    }

    // Start with the base query
    let query = supabase.from(params.from);
    let queryResult = {};

    // Map of supported actions
    const actionMap = {
      'select': () => {
        // Handle select with optional columns
        const columns = params.columns || '*';
        return query.select(columns);
      },
      'insert': () => {
        // Handle single or multiple inserts
        const data = params.data;
        return query.insert(data);
      },
      'update': () => {
        // Handle update with conditions
        const updateData = params.data;

        // Apply conditions
        if (params.conditions) {
          params.conditions.forEach(condition => {
            switch(condition.evaluation) {
              case 'eq':
                queryResult = query.update().eq(condition.value[0], condition.value[1]);
                break;
              case 'neq':
                queryResult = query.update().neq(condition.value[0], condition.value[1]);
                break;
              case 'gt':
                queryResult = query.update().gt(condition.value[0], condition.value[1]);
                break;
              case 'lt':
                queryResult = query.update().lt(condition.value[0], condition.value[1]);
                break;
              case 'in':
                queryResult = query.update().in(condition.value[0], condition.value[1]);
                break;
              default:
                throw new Error(`Unsupported condition: ${condition.evaluation}`);
            }
          });
        }

        return queryResult;
      },
      'delete': () => {
        // Handle delete with conditions
        if (params.conditions) {
          params.conditions.forEach(condition => {
            switch(condition.evaluation) {
              case 'eq':
                queryResult = query.delete().eq(condition.value[0], condition.value[1]);
                break;
              case 'in':
                queryResult = query.delete().in(condition.value[0], condition.value[1]);
                break;
              default:
                throw new Error(`Unsupported condition: ${condition.evaluation}`);
            }
          });
        }

        return queryResult;
      },
      'upsert': () => {
        // Handle upsert with optional conflict resolution
        const data = params.data;
        const options = params.options || {};
        return query.upsert(data, options);
      }
    };

    // Check if the action is supported
    if (!actionMap[params.action]) {
      throw new Error(`Unsupported action: ${params.action}`);
    }

    // Execute the query
    const { data, error } = await actionMap[params.action]();

    // Handle potential errors
    if (error) {
      console.error('Supabase Operation Error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }

    // Return successful result
    return { 
      success: true, 
      data: data 
    };
  } catch (error) {
    console.error('Dynamic Supabase Operation Error:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Base instructions prompt that explains response format to the LLM
const getInstructionsPrompt = () => `- You are a helpful assistant that responds in JSON format.
- Your responses must be valid JSON without any code block wrappers.
- Your responses will be used programatically by an AI agent, so the format of the 
   response is important.
- Because you are part of this AI agent, you can utilize functions that can be called 
   by populating the "function", "parameters", and "reasoning" fields in your structured response.
- You may need to utilize a data retrieval function to answer a question about information
   in a database if that information is needed to answer the question.
- This means you can't provide an answer to the user directly in this chat completion, and
   another request to an LLM will be made which will include the information that 
   the function retrieves from the database using the parameters you gave it.
- This is a multi-step process coordinated programatically by the AI agent, and you may
   be receiving the intial user query, or you may receive the results data from 
   function calls along with the conversation history and reasoning.
- Whether you are receiving the initial user query or function results and a 
   conversation history will be revealed further below in this system prompt.

The JSON of your response should have the following structure:
{
  "answer": "The direct answer to the user's question", // Leave empty if a function is being used
  "reasoning": "", // Overall strategy and rationale for each function use. Leave empty if no function is being used
  "function_calls": [ // Functions list to be performed simultaneously. Leave empty if no function is being used
    {
      "function": "", // Name of function 1 to be called. 
      "parameters": {}, // Each function may require different parameters. 
    }
    {
      "function": "", // Name of function 2 to be called. 
      "parameters": {}, // Each function may require different parameters. 
    }
  ],
}

- Only use a function if explicitly needed for tasks.
- For questions that need no functions to answer, just provide the answer directly.
- For questions that need multiple simultaneous function calls to answer, respond with a list of 
   functions to call and their parameters. There can be multiple rounds of multiple simultaneous 
   function calls, and the agent will iteratively provide the information from all previous 
   function calls to new, follow-up LLM chat completions, and those LLM chat completions 
   can request further function calls until an answer to the user query can be generated. 
- Do not prompt the user for further information or permission to use functions. 
- Assume that you are to infer what functions are needed, use them in batches preferably, 
   or in sequence if needed, and provide an answer to the best of your ability when you have 
   gathered the information needed.

Current functions:
1)
Function name: dynamicSupabaseOperation
Function parameters: from, action, columns, data, conditions, options
Function description: 
   This function provides a flexible way to interact with the Supabase databases.
   
   Available Tables:
   1) The user's current to-do list
   - Table name: "todo_list"
   - Columns: "id", "created_at", "description", "status"

   2) The user's current shopping list
   - Table name: "shopping_list"
   - Columns: "id", "created_at", "description", "status"

   Available Actions:
   - "select": Retrieve data from the database
   - "insert": Add new data to the database
   - "update": Modify existing data in the database
   - "delete": Remove data from the database
   - "upsert": Insert or update data in the database

Function usage:
   Detailed Usage Guide:
   - You can perform SELECT, INSERT, UPDATE, DELETE, and UPSERT operations
   - Provides a structured way to query and modify database tables
   - Supports complex conditions and filtering
   
   Function Call Structure:
   {
     "answer":""
     "reasoning": "Explain the purpose of the database operation"
     "function_calls": [
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "table_name", // Required: specifies the target table
          "action": "select|insert|update|delete|upsert", // Required: type of operation
          "columns": "['column1', 'column2']", // Optional for select
          "data": {}, // Data for insert/update/upsert
          "conditions": [], // Optional filtering conditions
        },
      }
    ]
   }
   
   Condition Types:
   - "eq": Equal to
   - "neq": Not equal to
   - "gt": Greater than
   - "lt": Less than
   - "in": Matches any value in a list
   
   Example Operations:
   1. User query requires agent to retrieve active to-do and shopping items:
   {
     "answer":""
     "reasoning": "Calling function dynamicSupabaseOperation with the action 'select' twice, 
         once to collect the to-do list items, and once to collect the shopping list items, because
         both will be needed to answer the user query"
     "function_calls": [
       {
         "function": "dynamicSupabaseOperation",
         "parameters": {
           "from": "todo_list",
           "action": "select",
           "conditions": [{"evaluation": "eq", "value": ["status", "active"]}]
         }
       },
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "shopping_list",
          "action": "select",
          "conditions": [{"evaluation": "eq", "value": ["status", "active"]}]
        }
       }
     ],
   }
   
   2. Update task status given the id of the list item:
   {
     "answer":""
     "reasoning": "The user provided the id of the item on his to-do list to be marked as completed so
        I will call function dynamicSupabaseOperation with the action 'update' using this ID. I then call
        the same function with action 'select' to verify that the list item has been updated."
     "function_calls": [{
         "function": "dynamicSupabaseOperation",
         "parameters": {
           "from": "todo_list",
           "action": "update",
           "conditions": [{"evaluation": "eq", "value": ["id", 1]}],
           "data": {"status": "completed"}
         }  
       },
       {
        "function": "dynamicSupabaseOperation",
        "parameters": {
          "from": "todo_list",
          "action": "select",
        }
      },
     ],
   }

   Additional instructions:
   - If the user requests to delete or modify a list item based on it's 'description' you must
     first select the full list and read all of the descriptions to find the ID of the matching
     item. This means you cannot complete the deletion or modification in this chat completion. 
     You must use RAG to get the list values and pass this back to the agent along with your 
     reasonining which includes next steps.
   - Always call the function dynamicSupabaseOperation with the action 'select' at the end of the list 
     of function_calls to retrieve the list after any modifications have been made to verify success.
     The user will be notified of success after the agent performs the function calls and returns the
     results to a new LLM chat completion to verify. 

Remember: Your whole response must be valid JSON without any code tags
`;

async function makeAIRequest(messages) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://yourwebsite.com",
        "X-Title": "Your Website Name",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-r1-distill-llama-70b:free",
        messages: messages,
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    
    // Extract the message content
    const rawReply = data.choices?.[0]?.message?.content || "No response";
    
    // Parse the JSON response
    let parsedReply;
    try {
        // Check if the response is wrapped in a code block
        let jsonContent = rawReply;
        
        // Check for markdown code blocks (```json ... ```) and remove any preamble text
        if (rawReply.includes("```json") || rawReply.includes("```")) {
            // Extract content between the code block markers, ignoring any text before the code block
            const codeBlockMatch = rawReply.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                jsonContent = codeBlockMatch[1].trim();
                // We've found and extracted the code block, so any preamble is automatically removed
            }
        } else {
            // If no code block is found, remove any text before the first opening brace
            const firstBraceIndex = jsonContent.indexOf('{');
            if (firstBraceIndex > 0) {
                jsonContent = jsonContent.substring(firstBraceIndex);
            }
        }

        // Make sure there was a response
        if (rawReply.trim().startsWith("No response") ) {
            return { answer: "Error: No response from LLM", function: "", parameters: {} };
        }

        // Remove any text before the first opening brace
        const firstBraceIndex = jsonContent.indexOf('{');
        if (firstBraceIndex > 0) {
            jsonContent = jsonContent.substring(firstBraceIndex);
        }

        // Parse the cleaned JSON content
        parsedReply = JSON.parse(jsonContent);
        return parsedReply;
    } catch (e) {
        console.error("Failed to parse response as JSON:", e);
        console.log("Raw response:", rawReply);
        return { answer: "Error: Failed to parse AI response as JSON", function: "", parameters: {} };
    }
  } catch (error) {
    console.error("Error making AI request:", error);
    return { answer: "Error: Failed to communicate with AI service", function: "", parameters: {} };
  }
}

async function executeFunctions(functionCalls) {
    console.log(`Executing ${functionCalls.length} functions simultaneously`);

    // Create an array of promises for each function execution
    const functionPromises = functionCalls.map(async (functionCall) => {
        const { function: functionName, parameters } = functionCall;
        
        console.log(`Preparing function: ${functionName}`);
        console.log(`Parameters:`, parameters);
        
        if (!functionMap[functionName]) {
        return { 
            function: functionName,
            parameters: parameters,
            result: { error: `Function ${functionName} not found` } 
        };
        }
        
        try {
        const result = await functionMap[functionName](parameters);
        return {
            function: functionName,
            parameters: parameters,
            result
        };
        } catch (error) {
        console.error(`Error executing function ${functionName}:`, error);
        return { 
            function: functionName,
            parameters: parameters,
            result: { error: `Failed to execute function ${functionName}` } 
        };
        }
    });

    // Execute all functions simultaneously
    const results = await Promise.all(functionPromises);

    // Combine all results into a single string
    const combinedResults = results.map(item => {
        return `Function '${item.function}(${JSON.stringify(item.parameters)})' output the result: ${JSON.stringify(item.result)}`;
    }).join(". ");

    return combinedResults;
}

async function runAIAgent(userPrompt) {
  // Initialize conversation history
  let conversationHistory = [
    { role: "user", content: userPrompt }
  ];
  
  // Maximum number of iterations to prevent infinite loops
  const MAX_ITERATIONS = 5;
  let iterations = 0;
  let functionsResult = null;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n--- Iteration ${iterations} ---`);
    
    // Build the current context for the AI
    let currentfunctionsResult = "";
    if (iterations > 1 && functionsResult) {
      currentfunctionsResult = `\n\nFunction Result:\n${JSON.stringify(functionsResult, null, 2)}`;
    }
    
    // Format the conversation history as a string for the system prompt
    let historyText = "\n\nConversation History:";
    for (const message of conversationHistory) {
      historyText += `\n${message.role}: ${message.content}`;
    }
    
    // Combine everything into the full agent prompt
    const fullAgentPrompt = getInstructionsPrompt() + historyText + currentfunctionsResult;
    
    // Prepare messages for the AI request
    const messages = [
      { role: "system", content: fullAgentPrompt },
    ];
    
    // Only add the user message for the first iteration
    // For subsequent iterations, the conversation history is in the system prompt
    if (iterations === 1) {
      messages.push({ role: "user", content: userPrompt });
    }
    
    // Make the request to the AI
    const aiResponse = await makeAIRequest(messages);
    
    // Check if we need to call a function
    if (aiResponse.function_calls && aiResponse.function_calls.length > 0) {
      // Execute the requested function
      functionsResult = await executeFunctions(aiResponse.function_calls);
      console.log(`Results:`, functionsResult);

      // Add the function call and result to the conversation history
      conversationHistory.push(
        { role: "assistant", content: `Calling function list: ${JSON.stringify(aiResponse.function_calls)} and reasoning: ${aiResponse.reasoning}.` }
      );      
      conversationHistory.push(
        { role: "function", content: `${functionsResult}` }
      );
      
      // Continue the loop with the function result
      continue;
    } else {
      // No function call, we have the final answer
      
      // Add the final response to conversation history
      conversationHistory.push({ role: "assistant", content: aiResponse.answer });
      
      // Return the final result
      return {
        answer: aiResponse.answer,
        conversationHistory: conversationHistory
      };
    }
  }
  
  // If we've reached the maximum number of iterations without a final answer
  console.log(`\nReached maximum iterations (${MAX_ITERATIONS}) without a final answer.`);
  return {
    answer: "I couldn't complete your request after several attempts. Please try rephrasing your question.",
    conversationHistory: conversationHistory
  };
}

// The Lambda handler function
export const handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    // Parse the user query from the event
    let userQuery;
    
    // Check if the event is from API Gateway
    if (event.body) {
      // Handle API Gateway request
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      userQuery = body.query || "No query provided";
    } else if (event.queryStringParameters && event.queryStringParameters.query) {
      // Handle query string parameter
      userQuery = event.queryStringParameters.query;
    } else {
      // Fallback or direct invocation
      userQuery = event.query || "No query provided";
    }
    
    // Run the AI agent with the user's query
    const result = await runAIAgent(userQuery);
    
    // Return a properly formatted response for API Gateway
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // For CORS support
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
      },
      body: {
        message: result.answer,
        conversationHistory: result.conversationHistory
      }
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Return error response
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
      },
      body: {
        message: 'Error processing your request',
        error: error.message
      }
    };
  }
};

