<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_postings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_company_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title_en')->nullable();
            $table->string('title_ar')->nullable();
            $table->string('city')->nullable();
            $table->string('area')->nullable();
            $table->string('employment_type')->default('full_time');
            $table->string('salary_text')->nullable();
            $table->text('responsibilities_en')->nullable();
            $table->text('responsibilities_ar')->nullable();
            $table->text('requirements_en')->nullable();
            $table->text('requirements_ar')->nullable();
            $table->json('questions')->nullable();
            $table->boolean('show_client_name')->default(false);
            $table->string('status')->default('draft')->index();
            $table->date('closes_on')->nullable();
            $table->string('slug')->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_postings');
    }
};
