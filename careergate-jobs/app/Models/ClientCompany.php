<?php

namespace App\Models;

use Database\Factories\ClientCompanyFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClientCompany extends Model
{
    /** @use HasFactory<ClientCompanyFactory> */
    use HasFactory;

    protected $guarded = [];

    public function jobPostings(): HasMany
    {
        return $this->hasMany(JobPosting::class);
    }
}
